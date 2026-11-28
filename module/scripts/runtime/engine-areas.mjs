/**
 * The area effects placed by a use (dnd5e regions): the resolution that opens on the area, clouds and instant
 * areas. Extracted from runtime/engine.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { selectAreaTargets, eligibleAreaTargets, zoneChoiceNeeded, openArea, turnKeyOf, actsOnPose, sliceOf } from "../core/area.mjs";
import { isChoiceZone, zoneChoiceMode, askZoneChoice } from "../adapter/zone-choice.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { readActivityRegion, repairSaveAbility, showTargetsTo } from "../adapter/saves.mjs";
import { readUsage } from "../adapter/usage.mjs";
import { concentrationEffectOf, tieRegionToConcentration } from "../adapter/concentration.mjs";
import { areaRulesOf, isInstantaneous, writeAreaState, markTransient, shrinkToBolt, removeTransientRegions, hideRegion, zoneCenter } from "../adapter/areas.mjs";
import { ensureRegionElevation } from "../adapter/space.mjs";
import { stormOf, isBoltRegion } from "../adapter/storm.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { contentOf } from "../adapter/content.mjs";
import { leaveDifficultTerrain } from "../adapter/zone-effects.mjs";
import { scatterOf, scatterState } from "./scatter.mjs";
import { flammableOf, groundFlammableState, igniteUnder } from "./flammable.mjs";
import { log } from "./shared.mjs";
import { enterAllInside } from "./areas.mjs";
import { LOOKBACK, TRANSIENT_LINGER_MS, dispatcher, openingFor } from "./engine.mjs";
import { tokenArt } from "../adapter/token-art.mjs";

/* -------------------------------------------- */
/*  Zones d'effet                               */
/* -------------------------------------------- */

/** The latest use message of this activity; `unresolved`: which does not yet have a resolution. */
function findUsage(activityUuid, { unresolved=false }={}) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - LOOKBACK); i-- ) {
    const message = messages[i];
    if ( (message.type !== "usage") || (unresolved && dispatcher.peek(message.id)) ) continue;
    if ( message.getAssociatedActivity?.()?.uuid === activityUuid ) return message;
  }
  return null;
}

/** §70: the region placed by a storm spell that is not a lightning bolt — the cloud. */
function isCloudRegion(region) {
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  return !!stormOf(item) && !isBoltRegion(region);
}

/** An area has just been placed: those it covers are the activity's targets. */
export async function onRegionCreated(region) {
  // P2: a region created without an elevation slice (connector, macro) receives it before we read who is inside.
  const slice = await ensureRegionElevation(region);
  if ( slice ) log(`area: elevation slice ${slice.bottom} → ${slice.top} ${region.parent.grid.units}`);
  // §16.21: Call Lightning — the placed area is the item's cloud; the lightning strikes at 5 ft from the chosen point.
  const bolt = await shrinkToBolt(region);
  if ( bolt ) log("area moved to the struck point (lightning)");
  const area = await readActivityRegion(region);
  if ( !area ) return;
  // §188 b: a fire area placed on a flammable area (oil puddle, web) ignites it.
  const lit = await igniteUnder(region, fromUuidSync(area.activity ?? "", { strict: false }));
  if ( lit ) log(`area: ${lit} flammable area(s) ignited`);

  // Area of a concentration spell: it will fall with it (runtime/concentration.mjs).
  // §70: the cloud — failing the message, the spell's ongoing concentration.
  const effect = concentrationEffectOf(findUsage(area.activity))
    ?? (isCloudRegion(region) ? concentrationOn(fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false })) : null);
  if ( effect ) {
    await tieRegionToConcentration(region, effect);
    log(`area attached to concentration "${effect.name}"`);
  }

  // §70: a storm spell's cloud resolves nothing — the lightning, aimed below, will.
  if ( isCloudRegion(region) ) { log("storm: cloud placed, waiting for the lightning"); return; }

  const message = findUsage(area.activity, { unresolved: true });
  if ( !message ) return;
  await dispatcher.open(message.id, async () => {
    await repairSaveAbility(message);
    const usage = readUsage(message);
    const activity = message.getAssociatedActivity?.({ scaled: true });
    const rules = areaRulesOf(activity);
    // An activity that only PLACES the area (utility with no effect) has nothing to resolve itself;
    // if a sibling must replay (Stinking Cloud), the area is still kept as a lasting area.
    if ( !usage?.area && !rules?.activity && !rules?.casterPulse ) return null;
    let targets = selectAreaTargets(area.candidates, area).map(({ token, actor, name }) => ({ token, actor, name }));
    // §401: "creatures of your choice" — the caster chooses among those the area can affect (checked in advance: the default).
    const picked = usage?.area ? await askAreaChoice(area, activity, targets) : null;
    if ( picked ) targets = picked.targets;
    log(`area placed: ${area.candidates.length} token(s) covered, ${targets.length} affected`);
    if ( usage?.area ) showTargetsTo(message.author, targets.map(t => t.token));

    // §187: a spilled object (caltrops, ball bearings) has no duration, but its area stays — until it is picked up.
    const scatter = scatterOf(activity);
    // §188: oil spread on the ground also stays (without replay: it only acts once ignited, runtime/flammable.mjs).
    const ground = flammableOf(activity)?.ground === true;
    const lasting = rules ?? (ground ? { on: [], activity: null } : null);
    // §403: an area that the content makes last (`zoneLasts`: Symbol, the 18 m sphere for 10 minutes), even instant.
    // Not a utility activity (Symbol: "Inscribe Glyph" places the glyph, it has nothing to replay).
    const lasts = !!contentOf(activity.item).entry?.zoneLasts && (activity.type !== "utility");
    if ( lasting && (!isInstantaneous(activity) || scatter || ground || lasts) ) {
      const rules = lasting;
      // Lasting area: it will replay its activity (runtime/areas.mjs). Those it touches at
      // placement count as touched for this game turn — unless a sibling is acting and the placement does nothing.
      const key = turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);
      // §300 (pass C5): an area whose text provides nothing at casting (`quietPose`: Sleet Storm, Stinking Cloud)
      // only acts at the declared moments — those already inside save when starting their turn.
      // §396: an area restored by the GM's correction does not act at placement either (card marked `quietPose`).
      const quiet = (contentOf(activity.item).entry?.quietPose === true) || (message.getFlag(MODULE_ID, "quietPose") === true);
      await writeAreaState(region, {
        ...openArea(rules.on, key, (usage?.area && actsOnPose(rules.on) && !scatter && !quiet) ? targets.map(t => t.token) : []),
        usage: message.id,
        // §300: its center at placement — moving the area only makes "enter" those it additionally covers (runtime/areas.mjs).
        at: zoneCenter(region),
        // §551: and its elevation slice — a vertical move of the area (its caster flies) only makes "enter" those it now covers.
        slice: sliceOf(region._source.elevation),
        activity: rules.activity ?? null,
        ...(rules.activities ? { activities: rules.activities } : {}),
        exclude: area.excludeOrigin ? area.origin : null,
        // §91 : le lanceur, dont le tour fait agir la zone (`casterPulse`).
        source: area.origin ?? null,
        // §16.23: the area's replays respect whom it affects (Spirit Guardians spare allies).
        affects: area.affects ?? "", originDisposition: area.originDisposition ?? null, originSide: area.originSide ?? null,
        // §401: the caster's choice at placement — those they kept and those they spared; the others follow the default rule.
        ...(picked ? { picked: picked.targets.map(t => t.token), spared: picked.spared } : {}),
        ...(scatter ? { scatter: await scatterState(region, message, activity) } : {}),
        ...(ground ? await groundFlammableState(region, activity) : {})
      });
      log(`lasting area: acts on ${rules.on.join(", ")}, once per turn${rules.activity ? ` (replays activity ${rules.activity})` : ""}`);
      // C12-b: those it covers on appearing enter it (`enterOnPose`: Summon Celestial).
      // §438: only when the area is placed by an activity other than the one it replays (Spirit Guardians of the Player's
      // Handbook 3.0.0); the activity that both replays and places (2.2.0 form) resolves its placement itself, further down.
      if ( (contentOf(activity.item).entry?.enterOnPose === true) && !(rules.activity && (rules.activity === activity.id)) ) {
        enterAllInside(region);
        log(`${activity.item.name}: the creatures already inside enter the area`);
        return null;
      }
      // An area that only acts on movement (Spike Growth) does nothing at placement.
      // §91: an area that only acts on its caster's turn (`casterPulse`, no moment) resolves its placement like any other.
      // §187: a spilled object does not act on those already there — only on whoever enters.
      if ( !usage?.area || scatter || ground || quiet || (rules.on.length && !actsOnPose(rules.on)) ) return null;
    } else if ( isInstantaneous(activity) || bolt ) {
      await markTransient(region, message.id);
      // §261: Ice Storm — the Difficult Terrain stays when the area leaves.
      const caster = fromUuidSync(area.origin ?? "", { strict: false })?.actor ?? null;
      const left = await leaveDifficultTerrain(region, activity, { caster, combat: game.combat });
      if ( left ) log(`${activity.item.name}: difficult terrain left until the end of ${caster.name}'s next turn`);
      // §201: the resolution begins — the area no longer covers the spell's animation.
      await hideRegion(region);
      // No one inside: no resolution will come to remove it. We let it be seen for a moment.
      if ( !targets.length ) setTimeout(() => removeTransientRegions(message.id).catch(() => {}), TRANSIENT_LINGER_MS);
    }
    return openingFor(message, { ...usage, targets });
  });
}

/**
 * §401: the "creatures of your choice" question of a placed area, if the setting wants it. Returns `{ targets, spared }`, or null
 * (no question: the default choice holds).
 */
async function askAreaChoice(area, activity, targets) {
  if ( !isChoiceZone(activity) ) return null;
  const eligible = eligibleAreaTargets(area.candidates, area);
  if ( !zoneChoiceNeeded(zoneChoiceMode(), eligible, targets) ) return null;
  const casterToken = area.origin ? fromUuidSync(area.origin, { strict: false }) : null;
  const caster = casterToken?.actor ?? activity?.actor ?? null;
  if ( !caster ) return null;
  const chosen = new Set(targets.map(t => t.token));
  const candidates = eligible.map(c => {
    const token = fromUuidSync(c.token, { strict: false });
    return { token: c.token, name: c.name, img: token ? tokenArt(token) : "", checked: chosen.has(c.token),
      enemy: !!(casterToken && token && areEnemies(casterToken, token)) };
  });
  const answer = await askZoneChoice(caster, { item: activity.item?.name ?? activity.name, max: area.max ?? null, candidates });
  if ( !answer ) return null;
  const keep = new Set(answer.tokens);
  const out = eligible.filter(c => keep.has(c.token)).map(({ token, actor, name }) => ({ token, actor, name }));
  log(`${activity.item?.name}: the caster chose ${out.length} of ${eligible.length} creature(s) in the area`);
  return { targets: out, spared: eligible.filter(c => !keep.has(c.token)).map(c => c.token) };
}
