/**
 * Lasting areas of effect: what a spell declares, what a region holds, and how to replay
 * the activity against a creature without recasting the spell.
 *
 * Nothing in a dnd5e item says "save when entering or ending a turn inside it":
 * that is in the text. Hence a declaration in the registry (content/triggers.mjs, or
 * `flags["dnd5e-combat"].triggers` on the item): `{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }`.
 *
 * Verified in dnd5e 6.0.3: the Moonbeam activity carries `duration.units: "inst"` with
 * `override: false` (packs/_source/spells24/2nd-level/moonbeam.yml); once prepared it
 * therefore inherits the item's duration (1 minute). The prepared duration tells whether an area lasts.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, entryOfIdentifier } from "./content.mjs";
import { potionOfCast } from "./potions.mjs";
import { translateShapes, shapeCenter, expiryTime, siblingsByMoment, fromPulseReached } from "../core/area.mjs";
import { stepsOf, holds } from "../core/triggers.mjs";
import { factsFor } from "./facts.mjs";
import { committedPosition, speakerTokenOf } from "./turn.mjs";
import { declarationsOfItem } from "./triggers.mjs";
import { lengthIn } from "./units.mjs";

/**
 * What an activity declares for its area (moments when it replays its activity, core/area.mjs), or
 * null if it only acts on placement: the item's declarations with a `replay` stage (registry).
 * `activity`: the id of a SIBLING activity to replay instead of the one that placed the area (Stinking
 * Cloud: "Create a cloud" places, "Start-of-turn save" replays), or null.
 */
export function areaRulesOf(activity) {
  if ( !activity?.item ) return null;
  const on = new Set();
  let sibling = null;
  const perDeclaration = [];
  for ( const d of declarationsOfItem(activity.item) ) {
    const replays = stepsOf(d, "replay");
    if ( !replays.length ) continue;
    d.on.forEach(m => on.add(m));
    let own = null;
    for ( const step of replays ) if ( step.activity && activity.item.system.activities?.get(step.activity) ) sibling = own = step.activity;
    perDeclaration.push({ on: d.on, activity: own });
  }
  // §91: an area that acts on its caster's turn (`casterPulse`) also lasts, even with no replay on creatures' turns.
  const casterPulse = !!contentOf(activity.item).entry?.casterPulse || !!contentOf(activity.item).entry?.zoneEnd;
  // §80: one activity per moment when they differ (Hunger of Hadar).
  return (on.size || casterPulse) ? { on: Array.from(on), activity: sibling, activities: siblingsByMoment(perDeclaration), ...(casterPulse ? { casterPulse } : {}) } : null;
}

/**
 * §164: the activity to replay on THIS creature when an area declaration carries a condition (`if`):
 * the first that holds, with the caster as source and the creature as target (Summon Celestial: healing light
 * for an ally, searing light for an enemy). Null: no conditional declaration applies, the area replays as usual.
 */
export function conditionalReplay(usageMessage, event, token) {
  const activity = usageMessage?.getAssociatedActivity?.();
  const item = activity?.item;
  if ( !item ) return null;
  const caster = usageMessage.getAssociatedActor?.() ?? null;
  const casterToken = speakerTokenOf(usageMessage);
  for ( const d of declarationsOfItem(item) ) {
    if ( !d.if || !d.on.includes(event) ) continue;
    const step = stepsOf(d, "replay").find(s => s.activity && item.system.activities?.get(s.activity));
    if ( !step ) continue;
    if ( holds(d.if, factsFor({ source: caster, target: token.actor, activity, sourceToken: casterToken, targetToken: token })) ) return step.activity;
  }
  return null;
}

/** The area of an instant activity has no reason to exist once the resolution is closed. */
export function isInstantaneous(activity) {
  return (activity?.duration?.units ?? "inst") === "inst";
}

export function readAreaState(region) {
  return region.getFlag(MODULE_ID, "area") ?? null;
}

export async function writeAreaState(region, state) {
  await region.setFlag(MODULE_ID, "area", state);
}

/**
 * The lasting area that this item from this caster placed on the displayed scene, or null (§16.14). A region placed by a
 * dnd5e 6 activity carries `flags.dnd5e.item` = the item's uuid.
 */
export function activeZoneOf(item) {
  if ( !item || !canvas?.scene ) return null;
  return canvas.scene.regions.find(r => (r.getFlag("dnd5e", "item") === item.uuid) && readAreaState(r)?.usage) ?? null;
}

/** The center of an area, in pixels (its first shape). */
export function zoneCenter(region) {
  return shapeCenter(region?.shapes?.[0]?.toObject?.() ?? region?._source?.shapes?.[0] ?? null);
}

/** Moves an area so its center lands on this point. Active GM only (a player cannot modify a region). */
export async function moveZoneTo(region, point) {
  const center = zoneCenter(region);
  if ( !center ) return false;
  const shapes = region.toObject().shapes;
  await region.update({ shapes: translateShapes(shapes, point.x - center.x, point.y - center.y) });
  return true;
}

/** The scene's regions held by the engine as lasting areas. */
export function lastingRegions(scene) {
  return scene?.regions.filter(r => readAreaState(r)?.usage) ?? [];
}

/**
 * §367: the lasting area (`noRangedWeapons`, Storm of Vengeance) this token stands in and where ranged attacks with
 * a weapon are impossible — `fromPulse`: only from this replay by the caster (`pulses` of the area's state).
 * Returns the item, or null.
 */
export function rangedBanAround(token) {
  for ( const region of lastingRegions(token?.parent) ) {
    const uuid = region.getFlag?.("dnd5e", "activity");
    const item = uuid ? fromUuidSync(uuid, { strict: false })?.item : null;
    const rule = item ? contentOf(item).entry?.noRangedWeapons : null;
    if ( !rule ) continue;
    if ( !fromPulseReached(rule, readAreaState(region)?.pulses) ) continue;
    if ( isInside(token, region) ) return item;
  }
  return null;
}

/**
 * §403: the lasting area (`formLock`, Moonbeam) this token stands in — "as long as it stays in the light, it cannot
 * take another form". Returns the item, or null.
 */
export function formLockAround(token) {
  for ( const region of lastingRegions(token?.parent) ) {
    const uuid = region.getFlag?.("dnd5e", "activity");
    const item = uuid ? fromUuidSync(uuid, { strict: false })?.item : null;
    if ( item && (contentOf(item).entry?.formLock === true) && isInside(token, region) ) return item;
  }
  return null;
}

/** Is this token in the region, at its current position or at a given position? */
export function isInside(token, region, position) {
  // Without a given position: the committed position, not the visual position (see committedPosition).
  return token.testInsideRegion(region, position ?? committedPosition(token));
}

/** Target descriptor as the system stores it on a message (targets-field.mjs:32-47). */
export function describeTarget(token) {
  const actor = token.actor;
  return {
    actor: actor.uuid, token: token.uuid, name: token.name, img: token.texture?.src,
    ac: actor.statuses.has("coverTotal") ? null : actor.system.attributes?.ac?.value ?? null
  };
}

/**
 * Replays an area's activity against a token: a copy of the original usage message,
 * with this single target. Everything else follows — same spell level, same DC, same concentration —
 * and the usual save resolution applies as is. No resource is
 * spent: we do not go back through `activity.use()`. Active GM only.
 * `activity`: the id of a sibling activity to replay instead (areaRulesOf) — the message keeps the
 * spell level and the concentration of the placement, only the activity changes (`system.activity`, which is
 * what `getAssociatedActivity` reads, documents/chat-message.mjs:690-691).
 * @param {ChatMessage} usageMessage  Usage message that placed the area.
 * @param {TokenDocument} token
 * @param {{region: string, event: string}} tick
 * @param {{activity?: string|null}} [options]
 */
export async function replayAgainst(usageMessage, token, tick, { activity: siblingId=null }={}) {
  const activity = usageMessage.getAssociatedActivity?.();
  const sibling = siblingId ? activity?.item?.system.activities?.get(siblingId) : null;
  const system = { ...usageMessage.system.toObject(), targets: [describeTarget(token)] };
  if ( sibling ) system.activity = { ...(system.activity ?? {}), ...sibling.messageSources.activity };
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: usageMessage.speaker,
    flavor: game.i18n.format(`DND5ECOMBAT.Zone.${tick.event}`, { name: token.name, item: activity?.item?.name ?? "" }),
    system,
    flags: {
      dnd5e: foundry.utils.deepClone(usageMessage.flags?.dnd5e ?? {}),
      [MODULE_ID]: { areaTick: { ...tick, token: token.uuid } }
    }
  });
}

/**
 * Burst (§16.19, `burst`): the item's sibling activity plays on several creatures at once — a copy of the attack's usage
 * message (same spell level), activity replaced by the sibling, these targets, marked `areaTick`
 * (nothing spent, no area to wait for). Active GM only.
 * @param {ChatMessage} usageMessage   Usage message of the attack.
 * @param {TokenDocument[]} tokens
 * @param {Activity} sibling
 * @param {TokenDocument} center       The attack's target.
 */
export async function burstAround(usageMessage, tokens, sibling, center) {
  const system = { ...usageMessage.system.toObject(), targets: tokens.map(describeTarget) };
  system.activity = { ...(system.activity ?? {}), ...sibling.messageSources.activity };
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: usageMessage.speaker,
    flavor: game.i18n.format(tokens.length > 1 ? "DND5ECOMBAT.Eclat" : "DND5ECOMBAT.EclatCible", { item: sibling.item.name, name: center.name }),
    system,
    flags: {
      dnd5e: foundry.utils.deepClone(usageMessage.flags?.dnd5e ?? {}),
      [MODULE_ID]: { areaTick: { event: "burst", origin: usageMessage.id, token: center.uuid } }
    }
  });
}

/**
 * §91: replay on the caster's turn (`casterPulse`) — a copy of the placement's usage message (same spell level, same DC),
 * activity replaced by the sibling, all these targets at once, marked `areaTick` (nothing spent, no area to wait for).
 * Active GM only.
 * @param {ChatMessage} usageMessage
 * @param {TokenDocument[]} tokens
 * @param {Activity} sibling
 * @param {RegionDocument} region
 */
export async function pulseAll(usageMessage, tokens, sibling, region) {
  const system = { ...usageMessage.system.toObject(), targets: tokens.map(describeTarget) };
  system.activity = { ...(system.activity ?? {}), ...sibling.messageSources.activity };
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: usageMessage.speaker,
    flavor: game.i18n.format("DND5ECOMBAT.Zone.casterPulse", { item: sibling.item.name, activity: sibling.name || sibling.item.name }),
    system,
    flags: {
      dnd5e: foundry.utils.deepClone(usageMessage.flags?.dnd5e ?? {}),
      [MODULE_ID]: { areaTick: { event: "casterPulse", region: region.uuid, origin: usageMessage.id } }
    }
  });
}

/**
 * §406: the slot upscaling to write on a usage card fabricated by the engine (`getCardData` does not provide it) — that of the
 * carried effect if there is one (`flags.dnd5e.scaling`, set by dnd5e from the original card), otherwise that of the activity
 * already scaled (`item.scaledClone(n)`). The resolution re-reads the activity via `getAssociatedActivity({ scaled: true })`,
 * which reads only `system.scaling` of the card: without it, dice and effects fall back to the base level.
 * @returns {{scaling?: number}}
 */
export function cardScaling(activity, effect=null) {
  const n = Math.max(0, Math.trunc(Number(effect?.getFlag?.("dnd5e", "scaling") ?? activity?.item?.flags?.dnd5e?.scaling) || 0));
  return n ? { scaling: n } : {};
}

/**
 * Repeated save (SPEC §16, "resave" building block): the creature carrying an effect replays the
 * save of the activity that placed it — a fresh usage message, same shape as the system's
 * (`getCardData`, activity/mixin.mjs:769-778), this single target, and the `resave` flag:
 * the usage adapter draws only a save from it, no damage or effects; on success, the engine
 * removes the effect (runtime/engine.mjs). The DC is the activity's today (the caster's spell DC).
 * Active GM only.
 * @param {ActiveEffect} effect      The effect carried by the creature.
 * @param {Activity} activity        The save activity that placed it.
 * @param {TokenDocument} token      The creature.
 * @param {string} moment            "startOfTurn" | "endOfTurn" | "isDamaged"
 * @param {object} [options.stages]  §495: the state ladder `{ item, stages, onSuccess, critEnds }` (runtime/engine-commands.mjs).
 */
export async function resaveAgainst(effect, activity, token, moment, { onFail=null, keep=false, dodge=false, tally=null, advantage=false, save=null, stages=null }={}) {
  const caster = activity.item?.actor ?? null;
  const card = await activity.item.system.getCardData({ activity });
  // §43.1: the counter from before this roll, shown on the card.
  const count = effect.getFlag?.(MODULE_ID, "tally") ?? {};
  const counted = tally ? ` — ${game.i18n.format("DND5ECOMBAT.Resave.tally", { successes: count.successes ?? 0, successesMax: tally.successes, failures: count.failures ?? 0, failuresMax: tally.failures })}` : "";
  // §495: the stage reached, shown on the card (stage 0: the effect alone).
  const staged = stages ? ` — ${game.i18n.format("DND5ECOMBAT.Resave.stage", { level: effect.getFlag?.(MODULE_ID, "stage")?.level ?? 0, count: stages.stages.length })}` : "";
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ actor: caster }),
    flavor: game.i18n.format(`DND5ECOMBAT.Resave.${moment}`, { name: token.name, item: activity.item.name }) + counted + staged,
    system: { ...card, ...cardScaling(activity, effect), targets: [describeTarget(token)] },
    flags: {
      core: { canPopout: true },
      // §19.6: `onFail` — damage to the bearer that applies only if the save fails (Thorn's bleeding).
      // §37: `keep` — on success, the effect stays; `dodge` — on failure, the creature takes the Dodge action (Curse).
      [MODULE_ID]: { resave: { effect: effect.uuid, token: token.uuid, moment, ...(onFail ? { onFail } : {}), ...(keep ? { keep } : {}), ...(dodge ? { dodge } : {}), ...(tally ? { tally } : {}), ...(stages ? { stages } : {}), ...(save ? { save } : {}) },
        // §285: Tasha's Hideous Laughter — "Advantage on the save when it is triggered by damage" (per-target mode, §249).
        ...(advantage ? { targetModes: [{ token: token.uuid, mode: "advantage" }] } : {}) }
    }
  });
}

/**
 * A summoned object acting on a nearby creature (§16.15, `summon.pulse`: the flames of Flaming Sphere on whoever
 * ends its turn within 1.5 m): a fresh usage message of the object's activity, this single target, marked
 * `areaTick` — nothing is spent, the usual save resolution applies. The damage is what dnd5e gave
 * the object when summoning it (`bonuses.saveDamage` of the spell, activity/summon.mjs). Active GM only.
 * @param {Activity} activity       Activity of the summoned object.
 * @param {TokenDocument} source    The object.
 * @param {TokenDocument} token     The creature.
 */
export async function pulseAgainst(activity, source, token, moment="turnEnd") {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format({ enter: "DND5ECOMBAT.Pilote.PulseEnter", moves: "DND5ECOMBAT.Pilote.PulseMoves" }[moment] ?? "DND5ECOMBAT.Pilote.Pulse",
      { item: activity.item.name, name: token.name, source: source.name }),
    system: { ...card, ...cardScaling(activity), targets: [describeTarget(token)] },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event: "pulse", source: source.uuid, token: token.uuid } } }
  });
}

/**
 * Cunning Strike (§20): the save of the Cunning Strikes item plays on the creature the Sneak Attack just hit.
 * Same shape as `pulseAgainst`: fresh usage message, this single target, marked `areaTick` (`event: "cunningStrike"`) —
 * nothing is spent, the usual save resolution places the effect on a failure. Active GM only.
 * @param {Activity} activity       Save of the item (Poison, Trip…).
 * @param {TokenDocument} source    The rogue.
 * @param {TokenDocument} token     The creature hit.
 */
export async function strikeAgainst(activity, source, token, { flavor="DND5ECOMBAT.Sournoise.Carte", scaling=0, concentration=null }={}) {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format(flavor, { strike: activity.name || activity.item.name, name: token.name }),
    // §402: the casting level (`system.scaling` of the usage message) — dnd5e carries it over to effects placed from that message
    // (applications/components/effect-application.mjs:248), which start-of-turn damage re-reads (Ensnaring Strike at level 2: 2d6).
    // `concentration`: the id of the caster's concentration effect — dnd5e attaches the effects placed from that message to it.
    system: { ...card, ...cardScaling(activity), targets: [describeTarget(token)], ...(scaling ? { scaling } : {}), ...(concentration ? { concentration } : {}) },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event: "cunningStrike", source: source.uuid, token: token.uuid } } }
  });
}

/**
 * Bolt (§16.21, `bolt`): the area dnd5e places is the ITEM's (Call Lightning: the cloud, a cylinder of
 * 60 ft); the rule strikes "each creature within 1.5 m" of the chosen point. The region is reduced to a circle of that radius
 * around its center, before reading who is inside. Returns true if it was reduced.
 * @param {RegionDocument} region
 */
export async function shrinkToBolt(region) {
  const activity = await fromUuid(region.getFlag("dnd5e", "activity") ?? "");
  const rule = activity?.item ? contentOf(activity.item).entry?.bolt : null;
  // §70: a storm spell places the cloud (which stays) then the bolt, already at its size (adapter/storm.mjs).
  if ( rule && contentOf(activity.item).entry?.storm ) return !!region.getFlag(MODULE_ID, "bolt");
  const center = rule ? shapeCenter(region.shapes?.[0]?.toObject?.() ?? region._source.shapes?.[0]) : null;
  if ( !center ) return false;
  const grid = region.parent.grid;
  let radius = lengthIn(rule.radius, rule.units, grid.units);
  const px = (radius / grid.distance) * grid.size;
  // The V14 core snaps a circle to the grid as at placement (gridBased): a true circle is enough here.
  await region.update({ shapes: [{ type: "circle", x: center.x, y: center.y, radius: px + (grid.size / 2) }] });
  return true;
}

/** Minutes per duration unit, read from the system configuration (CONFIG.DND5E.timeUnits.<unit>.conversion). */
export function readTimeFactors() {
  const factors = {};
  for ( const [unit, config] of Object.entries(CONFIG.DND5E.timeUnits ?? {}) ) {
    if ( Number.isFinite(config?.conversion) ) factors[unit] = config.conversion;
  }
  return factors;
}

/**
 * §16.37: an area placed by a spell that lasts **without concentration** (Daylight, 1 hour) gets its end time
 * (`flags["dnd5e-combat"].expiresAt`, world time in seconds). A concentration area falls with it
 * (runtime/concentration.mjs); an instant area, with its resolution. Returns the recorded time, or null.
 */
export async function noteExpiry(region, now=game.time.worldTime) {
  const activity = fromUuidSync(region.getFlag("dnd5e", "activity") ?? "", { strict: false });
  const item = activity?.item;
  if ( !item ) return null;
  // O9h (§363): the spell an object had cast lasts what the object declares (Oil of Slipperiness: Grease, 8 hours) — the area
  // placed by the spell's copy, or by the object's own "cast" activity (direct placement).
  const potion = potionOfCast(item);
  // §403: `zoneLasts` — the duration the content gives the area (Symbol: 10 minutes, whatever the activity's duration is).
  const declared = potion?.identifier ? entryOfIdentifier(potion.identifier)?.castDuration?.seconds
    : ((activity.type === "cast") ? contentOf(item).entry?.castDuration?.seconds : (contentOf(item).entry?.zoneLasts?.seconds ?? null));
  if ( !Number.isFinite(declared) && isInstantaneous(activity) ) return null;
  if ( activity.duration?.concentration || item.requiresConcentration || item.system?.properties?.has?.("concentration") ) return null;
  const at = Number.isFinite(declared) ? now + declared : expiryTime(now, activity.duration ?? {}, readTimeFactors());
  if ( at === null ) return null;
  await region.setFlag(MODULE_ID, "expiresAt", at);
  return at;
}

/** Areas whose end time has passed, across all scenes. */
export function expiredRegions(now=game.time.worldTime) {
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const region of scene.regions ) {
      const at = region.getFlag(MODULE_ID, "expiresAt");
      // §436: an area that ends at the start of its caster's turn ("Antimagic Cone") waits for that turn
      // as long as its combat exists (runtime/antimagic.mjs); world time passes at the round change,
      // before the caster's turn if the caster does not play first.
      const turn = region.getFlag(MODULE_ID, "endsOnTurn");
      if ( turn?.combat && game.combats?.get(turn.combat) ) continue;
      if ( Number.isFinite(at) && (at <= now) ) out.push(region);
    }
  }
  return out;
}

/**
 * §201: an instant area that was used for aiming is no longer shown — it stays in play for the computation (a token's
 * membership does not depend on display), but no longer covers the spell animation (Foundry draws regions over the Sequencer
 * effects: table feedback of 2026-10-18, Automated Animations Fireball under the area). Visible only on the regions
 * layer (`REGION_VISIBILITY.LAYER`, common/constants.mjs:2212). Active GM.
 */
export async function hideRegion(region) {
  if ( !region?.parent?.regions.has(region.id) || (region.visibility === CONST.REGION_VISIBILITY.LAYER) ) return false;
  await region.update({ visibility: CONST.REGION_VISIBILITY.LAYER });
  return true;
}

/** Marks a region as transient: it will disappear with the resolution of the given message. */
export async function markTransient(region, usageMessageId) {
  await region.setFlag(MODULE_ID, "transient", usageMessageId);
}

/** Removes the transient regions of a usage message whose resolution is closed. */
export async function removeTransientRegions(usageMessageId) {
  let removed = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.regions.filter(r => r.getFlag(MODULE_ID, "transient") === usageMessageId).map(r => r.id);
    if ( !ids.length ) continue;
    // §153: two removals can cross (end of the resolution, delay of an empty area): a region already gone is not an error.
    const left = ids.filter(id => scene.regions.has(id));
    if ( !left.length ) continue;
    try { await scene.deleteEmbeddedDocuments("Region", left); }
    catch(err) { if ( !/does not exist/.test(err?.message ?? "") ) throw err; }
    removed += left.length;
  }
  return removed;
}

/**
 * M7 (§18.11): a monster's emanation acts — its activity plays on these creatures (Fire Aura at the end of its turn: all
 * those inside, one card; Stench at the start of a creature's turn: that creature only). Same shape as `pulseAgainst`:
 * a fresh usage message, marked `areaTick` (nothing spent, the engine rolls the dice). Active GM only.
 * @param {Activity} activity
 * @param {TokenDocument} source      The emanation's bearer.
 * @param {TokenDocument[]} tokens
 * @param {"ownTurnEnd"|"turnStart"} moment
 */
export async function emanationAgainst(activity, source, tokens, moment) {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format(`DND5ECOMBAT.Emanation.${moment}`, { item: activity.item.name, source: source.name, name: tokens[0]?.name ?? "" }),
    system: { ...card, ...cardScaling(activity), targets: tokens.map(describeTarget) },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: {
      event: "emanation", moment, source: source.uuid, key: activity.item.system.identifier ?? activity.item.id, token: tokens[0]?.uuid ?? null
    } } }
  });
}

/**
 * M8 (§18.17): the damage a swallowed creature takes each turn — the damage activity of the swallowing item, these creatures.
 * Same shape as `emanationAgainst`: fresh usage message, marked `areaTick` (`event: "swallow"`). Active GM.
 * @param {Activity} activity
 * @param {TokenDocument} source      The swallower.
 * @param {TokenDocument[]} tokens    The swallowed.
 * @param {string} moment             `ownerStart` | `ownerEnd` | `ownerEndOnce` | `targetStart` (start / end of swallower's turn,
 *                                     end of the next turn once, start of the swallowed creature's turn).
 * @param {{event?: string, flavor?: string}} [options]  §18.21: `engulf` — the entry activity on whoever the cube passes through.
 */
export async function swallowAgainst(activity, source, tokens, moment, { event="swallow", flavor="DND5ECOMBAT.Avale.Degats" }={}) {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format(flavor, { item: activity.item.name, source: source.name, names: tokens.map(t => t.name).join(", ") }),
    system: { ...card, ...cardScaling(activity), targets: tokens.map(describeTarget) },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event, moment, source: source.uuid, token: tokens[0]?.uuid ?? null } } }
  });
}
