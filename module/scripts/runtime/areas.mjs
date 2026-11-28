import { turnKeyOf, shouldTrigger, markHit, entersArea, positionBeforeAreaMove, sliceOf, stepsInside, siblingFor, hitKey, pulseFor, pulseTargets, pickedAtPose } from "../core/area.mjs";
import { MODULE_ID } from "../constants.mjs";
import { spellRetypes } from "../adapter/messages.mjs";
import { contentOf } from "../adapter/content.mjs";
import { readAreaState, writeAreaState, lastingRegions, isInside, replayAgainst, noteExpiry, expiredRegions, pulseAll, zoneCenter, moveZoneTo, conditionalReplay } from "../adapter/areas.mjs";
import { payWithoutUse } from "../adapter/reactions.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { placeAreaAt } from "../adapter/self-area.mjs";
import { positionOf as position, committedPosition, tokenCenter } from "../adapter/turn.mjs";
import { noteSummonExpiry, expiredSummons, replacedSummons } from "../adapter/summons.mjs";
import { holdZoneEffects, holdDifficultTerrain, syncZoneEffects } from "../adapter/zone-effects.mjs";
import { invalidateVision } from "../adapter/vision.mjs";
import { wallSideRuleOf, isThinWall, crossesWallRegion } from "../adapter/wall-side.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { announce } from "./triggers.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { sideOf, areEnemies } from "../adapter/factions.mjs";
import { zoneChoiceMode, askZoneChoice } from "../adapter/zone-choice.mjs";
import { registerAreaVisibilitySetting, applyAreaVisibility } from "../adapter/area-visibility.mjs";
import { alliedSides } from "../core/factions.mjs";
import { castLevelUsage } from "../core/usage.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { burnTick } from "./flammable.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { tokenArt } from "../adapter/token-art.mjs";
const currentTurnKey = () => turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);

/** Can the token suffer the zone? Not the creature that placed it from itself, not a dead one. */
function isAffectable(token, state) {
  if ( !token?.actor || (token.uuid === state.exclude) ) return false;
  if ( isObjectToken(token) ) return false;   // a driven object or a pile on the ground is not a creature (§16.15, §16.60)
  if ( token.actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) return false;
  // §225: a zone only acts on its plane, that of its caster.
  const caster = state.source ? fromUuidSync(state.source, { strict: false }) : null;
  if ( caster && !samePlane(caster, token) ) return false;
  // §401: the caster's choice at placement ("creatures of your choice") for those who were inside.
  const picked = pickedAtPose(state, token.uuid);
  if ( picked !== null ) return picked;
  // §16.23: same rule as at placement (core/area.mjs, selectAreaTargets) — allies or enemies of the caster only.
  if ( !["ally", "enemy"].includes(state.affects) || (state.originDisposition === null) || (state.originDisposition === undefined) ) return true;
  const sameSide = alliedSides(sideOf(token), state.originSide ?? { disposition: state.originDisposition });   // §181
  return state.affects === "ally" ? sameSide : !sameSide;
}

/**
 * The zone acts on a token, if its rules want it and it has not already been hit this turn.
 * Writes to the "already hit" memory are serialized per region.
 */
function tick(region, token, event, turnKey=currentTurnKey(), { times=1 }={}) {
  return enqueue(`area:${region.id}`, async () => {
    const state = readAreaState(region);
    if ( !state?.usage || !isAffectable(token, state) ) return;
    // §187: out of combat, each entry onto Caltrops counts (no "turn" that would reset the memory).
    // §188: likewise for a zone on fire.
    if ( (state.scatter || state.burning) && !game.combat?.started ) turnKey = `free:${Date.now()}`;
    const context = { event, token: hitKey(state, event, token.uuid), turnKey };
    if ( !shouldTrigger(state, context) ) return;
    const usageMessage = game.messages.get(state.usage);
    if ( !usageMessage ) return;
    await writeAreaState(region, { ...state, ...markHit(state, context) });
    log(`${region.name}: ${token.name} (${event})`);
    announce(event, { actor: token.actor, target: token.actor, region: region.uuid, usage: state.usage });
    // §188: a zone on fire burns (its fire damage) instead of replaying its activity.
    if ( state.burning ) return burnTick(region, token, state.burning);
    const chosen = conditionalReplay(usageMessage, event, token) ?? siblingFor(state, event);   // §164
    // §169: after its appearance, the wall with a burning face hurts without a save (crossing, end of turn on the burning side).
    const noSave = !!(wallSideRuleOf(region) || region.getFlag(MODULE_ID, "sideOf"));
    await replayAgainst(usageMessage, token, { region: region.uuid, event, ...(times > 1 ? { times } : {}), ...(noSave ? { noSave } : {}) }, { activity: chosen });
    // §75: a zone with a number of triggers (`zoneCharges`: Cordon of Arrows, 4 projectiles) ends at the last.
    // §303: or a formula of the casting level (Cordon of Arrows: "2 × level", data of the scaled activity).
    const declared = contentOf(usageMessage.getAssociatedActivity?.()?.item).entry?.zoneCharges;
    const scaled = (typeof declared === "string") ? usageMessage.getAssociatedActivity?.({ scaled: true }) : null;
    const charges = scaled ? (Number(Roll.safeEval(Roll.replaceFormulaData(declared, scaled.getRollData?.() ?? {}))) || 0) : declared;
    if ( charges ) {
      const fired = (Number(readAreaState(region)?.fired) || 0) + 1;
      if ( fired >= charges ) {
        log(`${region.name}: ${fired}/${charges} triggers, the area ends`);
        await region.delete();
      } else {
        await writeAreaState(region, { ...readAreaState(region), fired });
        log(`${region.name}: ${fired}/${charges} triggers`);
      }
    }
  });
}

/**
 * C12-b: the zone has just appeared (`enterOnPose`) — each creature it covers "enters" it (Summon Celestial: healed or
 * burned as soon as the Cylinder appears, not at its first end of turn). Once per turn, like any entry.
 */
export function enterAllInside(region) {
  for ( const token of region.parent?.tokens ?? [] ) if ( isInside(token, region) ) tick(region, token, "enter");
}

/**
 * On the ground (Earthquake: "in contact with the ground"): no higher than the bottom of its level (V14), 0 on a scene
 * without levels. The zone itself received an elevation slice (runtime/space.mjs) that goes below the ground: its bottom
 * says nothing.
 */
function grounded(token) {
  const pos = committedPosition(token);
  const bottom = Number(token.parent?.levels?.get?.(pos.level)?.elevation?.bottom);
  return (Number(pos.elevation) || 0) <= ((Number.isFinite(bottom) ? bottom : 0) + 1e-6);
}

/**
 * §91: the zone acts on its caster's turn (`casterPulse`) — replay number n (1 = the first turn after placement), the activity
 * of the entry that covers it, on what is inside (at most `max`, enemies first), or used by the caster (`use`).
 */
function casterPulse(region, caster, at) {
  return enqueue(`area:${region.id}`, async () => {
    const state = readAreaState(region);
    if ( !state?.usage || (state.source !== caster.uuid) ) return;
    const usageMessage = game.messages.get(state.usage);
    const item = usageMessage?.getAssociatedActivity?.()?.item;
    const rule = item ? contentOf(item).entry?.casterPulse : null;
    if ( !rule || (rule.at !== at) ) return;
    const n = (Number(state.pulses) || 0) + 1;
    await writeAreaState(region, { ...state, pulses: n });
    // What only holds from this turn of the caster (`fromPulse`, Storm of Vengeance): Difficult Terrain is placed, the vision
    // is recomputed (the zone now obscures).
    const whole = contentOf(item).entry ?? {};
    if ( whole.difficultTerrain?.fromPulse === n ) await holdDifficultTerrain(region);
    if ( whole.obscures?.fromPulse === n ) invalidateVision();
    const entry = pulseFor(rule, n);
    const sibling = entry ? item.system.activities?.get(entry.activity) : null;
    // Tsunami: the wall moves away from the caster before striking; §158: Cloudkill, Incendiary Cloud only drift (the
    // creatures that the zone covers on arrival "enter" it: the entry replay follows).
    if ( rule.away ) await driftAway(region, caster, rule.away);
    if ( !sibling ) { if ( !rule.away ) log(`${region.name}: caster's turn ${n}, nothing to replay`); return; }
    if ( entry.pay ) await payWithoutUse(sibling);
    if ( entry.use ) {
      // §406: at the casting level (use message of the zone), with no extra spell slot.
      await sibling.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: false }, consume: { spellSlot: false },
        ...castLevelUsage(item.system.level, usageMessage.system?.scaling) }, { configure: false }, { create: false });
      log(`${region.name}: caster's turn ${n}, "${sibling.name}" used`);
      return;
    }
    const inside = region.parent.tokens.filter(t => isInside(t, region) && isAffectable(t, state) && (!rule.ground || grounded(t)));
    let tokens = pulseTargets(inside.map(t => ({ ...sideOf(t), doc: t })), sideOf(caster), entry.max).map(t => t.doc);
    // §403: "six lightning bolts… on six creatures of your choice beneath the cloud" (Storm of Vengeance, turn 3) — more
    // creatures than bolts, or allies beneath: the caster chooses (zone window with choice, checked by default as before).
    if ( Number.isInteger(entry.max) && (zoneChoiceMode() !== "never")
      && ((inside.length > tokens.length) || tokens.some(t => !areEnemies(caster, t)) || (zoneChoiceMode() === "always")) ) tokens = await pickPulseTargets(caster, item, entry.max, inside, tokens);
    if ( !tokens.length ) log(`${region.name}: caster's turn ${n}, nobody in the area`);
    if ( tokens.length ) {
      log(`${region.name}: caster's turn ${n}, "${sibling.name}" on ${tokens.map(t => t.name).join(", ")}`);
      await pulseAll(usageMessage, tokens, sibling, region);
    }
    // "Once the wall's height is 0 m, the spell ends": the item has no more uses.
    if ( rule.untilSpent && !((Number(item.system.uses?.value) || 0) > 0) ) {
      log(`${region.name}: no uses left, the spell ends`);
      const effect = concentrationOn(item);
      // Concentration takes its zone with it (runtime/concentration.mjs); without it, the zone is removed here.
      if ( effect ) await item.actor?.endConcentration?.(effect);
      else if ( region.parent?.regions.get(region.id) ) await region.delete().catch(() => {});
    }
  });
}

/** §403: the caster chooses at most `max` creatures in the zone; with no answer, the default choice. */
async function pickPulseTargets(caster, item, max, inside, chosen) {
  const checked = new Set(chosen.map(t => t.uuid));
  const candidates = inside.map(t => ({ token: t.uuid, name: t.name, img: tokenArt(t), checked: checked.has(t.uuid), enemy: areEnemies(caster, t) }));
  const answer = await askZoneChoice(caster.actor, { item: item.name, max, candidates });
  if ( !answer ) return chosen;
  const keep = new Set(answer.tokens.slice(0, max));
  log(`${item.name}: the caster chose ${keep.size} creature(s) of ${inside.length}`);
  return inside.filter(t => keep.has(t.uuid));
}

/** §91: the zone moves away from the caster by `distance` (Tsunami: 15 m on each of its turns). */
async function driftAway(region, caster, { distance, units }) {
  const center = zoneCenter(region);
  if ( !center ) return;
  const scene = region.parent;
  const from = tokenCenter(caster);
  const dx = center.x - from.x, dy = center.y - from.y;
  const length = Math.hypot(dx, dy);
  if ( !(length > 0) ) return;
  let gridDistance = lengthIn(distance, units, scene.grid.units);
  const px = gridDistance * (scene.grid.size / scene.grid.distance);
  await moveZoneTo(region, { x: center.x + (dx / length) * px, y: center.y + (dy / length) * px });
  log(`${region.name}: moves away by ${distance} ${units}`);
}

/**
 * §91: the zone that lasts from an item with `zoneEnd` has just ended (Concentration broken, duration elapsed, removed) — the
 * caster uses the activity (consuming nothing, no window), then their zone is placed at the center of the one that ends; the
 * usual zone resolution follows. Active GM.
 */
async function onZoneEnd(region) {
  const state = readAreaState(region);
  const usageMessage = state?.usage ? game.messages.get(state.usage) : null;
  const item = usageMessage?.getAssociatedActivity?.()?.item;
  const rule = item ? contentOf(item).entry?.zoneEnd : null;
  const activity = rule ? item.system.activities?.get(rule.activity) : null;
  const caster = state?.source ? fromUuidSync(state.source, { strict: false }) : null;
  const point = zoneCenter(region);
  if ( !activity || !caster?.parent || !point ) return;
  log(`${region.name}: the area ends, "${activity.name}"`);
  // §406: at the casting level — Concentration ended with the zone, nothing else keeps the upcast (Delayed Blast Fireball
  // cast at level 9: 12d6 + 2d6, not 12d6).
  const used = await activity.use({ [MODULE_ID]: { confirmed: true }, create: { measuredTemplate: false }, consume: false,
    ...castLevelUsage(item.system.level, usageMessage.system?.scaling) }, { configure: false });
  if ( !used ) return;
  await placeAreaAt(activity, caster, point);
}

/** End of one's turn, start of the other's turn. */
function onTurnChange(combat, prior, current) {
  const scene = combat.scene ?? canvas.scene;
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  const started = combat.combatants.get(current?.combatantId)?.token;
  for ( const region of lastingRegions(scene) ) {
    // The end of a turn belongs to the turn that ends: a creature already hit during that
    // turn (at placement, on entering) is not hit again when ending it. Seen in play.
    if ( ended && (ended.parent === scene) && isInside(ended, region) ) {
      tick(region, ended, "turnEnd", turnKeyOf(prior.round, prior.turn));
    }
    if ( started && (started.parent === scene) && isInside(started, region) ) tick(region, started, "turnStart");
    if ( ended && (readAreaState(region)?.source === ended.uuid) ) casterPulse(region, ended, "turnEnd");
    if ( started && (readAreaState(region)?.source === started.uuid) ) casterPulse(region, started, "turnStart");
  }
}

/**
 * §100 bis: the cells traversed in a `moves` zone, per token, for the duration of a move that the core splits into chunks
 * (checkpoints of an engine walk, §99; regions): a single replay at the end, not one per chunk.
 * @type {Map<TokenDocument, {chain: string, counts: Map<RegionDocument, number>}>}
 */
const crossings = new Map();

/** The replay of the cells noted for this token (end of the move, or move stopped). */
function settleCrossings(token) {
  const pending = crossings.get(token);
  if ( !pending ) return;
  crossings.delete(token);
  for ( const [region, n] of pending.counts ) {
    if ( (n > 0) && region.parent ) tick(region, token, "moves", currentTurnKey(), { times: n });
  }
}

/** A token moves: does it enter a zone, cross it, and how many cells does it travel in it? */
function onMoveToken(token, movement) {
  const chain = movement.chain?.[0] ?? movement.id;
  if ( crossings.get(token)?.chain !== chain ) settleCrossings(token);   // another move: the previous one is closed
  const regions = lastingRegions(token.parent);
  if ( regions.length ) {
    const waypoints = [...(movement.passed?.waypoints ?? []), movement.destination].filter(Boolean).map(position);
    let steps = null;
    for ( const region of regions ) {
      // §169, §173: a thin wall — one also "enters" it by crossing it (a ring can pass through cell centers).
      if ( isThinWall(region) ) {
        steps ??= passedCells(token, movement);
        if ( steps.length && crossesWallRegion(region, token, [position(movement.origin), ...steps]) ) tick(region, token, "enter");
      }
      const before = isInside(token, region, position(movement.origin));
      if ( entersArea(before, waypoints.map(w => isInside(token, region, w))) ) tick(region, token, "enter");
      // §16.20: "for each 1.50 m traveled" in the zone — cell by cell along the path actually
      // traveled (teleportation excluded), a single replay with multiplied dice.
      if ( !readAreaState(region)?.on?.includes("moves") ) continue;
      steps ??= passedCells(token, movement);
      const n = stepsInside(steps.map(p => isInside(token, region, p)));
      if ( !(n > 0) ) continue;
      const entry = crossings.get(token) ?? { chain, counts: new Map() };
      entry.counts.set(region, (entry.counts.get(region) ?? 0) + n);
      crossings.set(token, entry);
    }
  }
  // The core will chain another chunk (`pending`): we wait for the end to replay.
  if ( (token.movement?.id === movement.id) && (token.movement.state === "pending") ) return;
  settleCrossings(token);
}

/** The arrival cells of the path traveled by this segment, start excluded (empty for a teleportation). */
function passedCells(token, movement) {
  const passed = movement.passed?.waypoints ?? [];
  if ( !passed.length || passed.every(w => CONFIG.Token.movement.actions[w.action]?.teleport) ) return [];
  const origin = position(movement.origin);
  return token.getCompleteMovementPath([origin, ...passed.map(position)]).slice(1).map(position);
}

/**
 * Multiplied dice (§16.20): a `moves` replay carries `times` in its roll configuration (adapter/messages.mjs); each
 * "XdY" term becomes "(X × n)dY" — "2d4 per increment" traveled.
 */
function onPreRollDamage(config) {
  // §16.27: the damage type chosen by the author (Chromatic Orb), for each roll that allows it.
  const damageType = config?.[MODULE_ID]?.damageType;
  // Survey of gaps: Psychic Spells — the extra type replaces that of the spell's parts (not of bonus damage added afterwards).
  const retyped = damageType && spellRetypes(config.subject).includes(damageType);
  if ( damageType ) for ( const roll of config.rolls ?? [] ) {
    const types = roll.options?.types ?? [];
    if ( retyped && !types.includes(damageType) ) roll.options.types = [...types, damageType];
    if ( retyped || types.includes(damageType) ) roll.options.type = damageType;
  }
  const times = config?.[MODULE_ID]?.times;
  if ( !(times > 1) ) return true;
  for ( const roll of config.rolls ?? [] ) {
    roll.parts = (roll.parts ?? []).map(part => String(part).replace(/(\d*)d(\d+)/g, (_, n, faces) => `${(Number(n) || 1) * times}d${faces}`));
  }
  return true;
}

/**
 * The zone itself moves (Moonbeam): it "enters" those it now covers.
 * §300 (pass C5): not those it already covered — Spirit Guardians follows its caster: at each step, every creature that stayed in
 * the Emanation redid its save ("when the Emanation enters a creature's space"). The zone's center is noted in its
 * state (`at`); a token that, brought back from the same move, was already inside does not enter. With no center noted
 * (earlier zone), as before.
 * §551: the elevation slice is noted too (`slice`), and the shift is `positionBeforeAreaMove` (core/area.mjs), which also fixes its
 * direction (a step towards a creature at the edge now makes it enter).
 */
function onUpdateRegion(region, changes) {
  const state = readAreaState(region);
  // §551: the core moves an attached Emanation's elevation slice with its token (client/documents/token.mjs:2525-2545) — a vertical
  // move of the caster is a move of the area too.
  if ( !state?.usage || !(("shapes" in changes) || ("attachment" in changes) || ("elevation" in changes)) ) return;
  const now = zoneCenter(region);
  const sliceNow = sliceOf(region._source.elevation);
  const move = { at: state.at ?? null, now, sliceBefore: ("slice" in state) ? state.slice : null, sliceNow };
  for ( const token of region.parent.tokens ) {
    if ( !isInside(token, region) ) continue;
    const before = positionBeforeAreaMove(committedPosition(token), move);
    if ( before && isInside(token, region, before) ) continue;   // already inside before the area moved
    tick(region, token, "enter");
  }
  enqueue(`area:${region.id}`, async () => {
    const current = readAreaState(region);
    if ( current?.usage ) await writeAreaState(region, { ...current, ...(now ? { at: now } : {}), slice: sliceNow });
  });
  releaseZoneBound(region.parent);
}

/**
 * §300 (pass C5): an effect of a `zoneBound` item only holds in a zone of that item — Spirit Guardians: "a creature's Speed is
 * halved in the Emanation". The effect placed by the save is removed from the creature that is in no zone of the item any more
 * (it leaves, the zone moves away, the zone ends); coming back replays the zone, which places it again. Active GM.
 */
function releaseZoneBound(scene, tokens=null) {
  if ( !scene ) return;
  return enqueue(`zone-bound:${scene.id}`, async () => {
    const zones = lastingRegions(scene).map(r => ({ region: r, item: game.messages.get(readAreaState(r).usage)?.getAssociatedActivity?.()?.item?.uuid }));
    for ( const token of tokens ?? scene.tokens ) {
      const actor = token.actor;
      if ( !actor ) continue;
      const gone = [];
      for ( const effect of actor.effects ) {
        const item = originItemOf(effect);
        // Not the caster's item on themselves (their Concentration), only what the zone placed on another creature.
        if ( !item || (item.actor === actor) || (contentOf(item).entry?.zoneBound !== true) ) continue;
        // §438: an effect placed by a dnd5e zone behavior (`system.origin.behavior`: the halved Speed of the Spirit
        // Guardians of the Player's Handbook 3.0.0) — dnd5e removes it itself on exit; removing it too caused a server error.
        if ( effect.system?.origin?.behavior ) continue;
        if ( zones.some(z => (z.item === item.uuid) && isInside(token, z.region)) ) continue;
        gone.push(effect.id);
      }
      if ( !gone.length ) continue;
      const left = gone.filter(id => actor.effects.has(id));
      // One by one: an effect removed in the meantime (by dnd5e, by another client) does not make the others fail.
      for ( const id of left ) if ( actor.effects.has(id) ) await actor.deleteEmbeddedDocuments("ActiveEffect", [id]).catch(() => null);
      log(`${token.name}: out of the area, ${left.length} effect(s) bound to it removed`);
    }
  });
}

/** A summon sent back: its combatants, then its token. Active GM. */
async function dismissSummon(token, why) {
  const name = token.name;
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter(c => (c.sceneId === token.parent.id) && (c.tokenId === token.id)).map(c => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  await token.delete();
  log(`${name}: ${why}, dismissed`);
}

/** §16.37: world time advances (rest, travel, combat rounds) — expired zones disappear. Active GM. */
async function onWorldTime(worldTime) {
  // §16.39: creatures summoned for a duration (Wild Companion) — and their combatants.
  for ( const token of expiredSummons(worldTime) ) await dismissSummon(token, "duration elapsed");
  const gone = expiredRegions(worldTime);
  for ( const region of gone ) {
    const name = region.name;
    await region.delete();
    log(`area "${name}": duration elapsed, removed`);
  }
}

export function registerAreas() {
  const trigger = { executor: true, label: "area: trigger interrupted" };
  // §530: who sees an area placed from an activity (world setting), set on the client that creates it.
  registerAreaVisibilitySetting();
  route("preCreateRegion", (region, data) => { applyAreaVisibility(region, data); }, { label: "area: visibility setting not applied" });
  route("createRegion", async region => {
    const at = await noteExpiry(region);
    if ( at !== null ) log(`area "${region.name}": ends at world time ${at} (in ${at - game.time.worldTime} s)`);
  }, { executor: true, label: "area: duration not recorded" });
  // §37.4: effects carried in the zone (Silence) — the core's behavior, which places and removes by itself.
  route("createRegion", async region => {
    const held = await holdZoneEffects(region);
    if ( held ) log(`area "${region.name}": ${held.effects.join(", ")} carried inside`);
  }, { executor: true, label: "area: carried effects not applied" });
  // §69: Difficult Terrain lost by the data (Entangle of the premium Player's Handbook…).
  route("createRegion", async region => {
    const behavior = await holdDifficultTerrain(region);
    if ( behavior ) log(`area "${region.name}": difficult terrain applied`);
  }, { executor: true, label: "area: difficult terrain not applied" });
  route("updateWorldTime", onWorldTime, { executor: true, label: "area: duration elapsed, not removed" });
  route("deleteRegion", onZoneEnd, { executor: true, label: "area: ended without its activity (zoneEnd)" });
  // §300: the effects held by a zone (`zoneBound`) fall outside it.
  route("deleteRegion", region => releaseZoneBound(region.parent), { executor: true, label: "area: bound effects not removed" });
  route("moveToken", token => {
    if ( (token.movement?.state === "pending") || !lastingRegions(token.parent).length ) return;
    // Like `syncZoneEffects`: a second later, the move is fully settled.
    setTimeout(() => releaseZoneBound(token.parent, [token])?.catch(err => console.error(`${MODULE_ID} | bound effects`, err)), 1000);
  }, { executor: true, label: "area: bound effects not removed" });
  route("createToken", async tokenDoc => {
    const at = await noteSummonExpiry(tokenDoc);
    if ( at !== null ) log(`${tokenDoc.name}: dismissed at world time ${at} (in ${at - game.time.worldTime} s)`);
  }, { executor: true, label: "summon: duration not recorded" });
  // §230 : Appel de destrier — le nouveau destrier remplace l'ancien.
  route("createToken", async tokenDoc => {
    for ( const token of replacedSummons(tokenDoc) ) await dismissSummon(token, `replaced by ${tokenDoc.name}`);
  }, { executor: true, label: "summon: previous one not replaced" });
  route("combatTurnChange", onTurnChange, trigger);
  route("moveToken", onMoveToken, trigger);
  // §191: the effects carried by a zone (Silence, "Radiant Storm") follow the position, teleportation included — after the
  // core's behavior, which acts on the entry and exit it sees (a second later: its creation or removal is done).
  route("moveToken", token => {
    if ( !token.parent?.regions.some(r => r.behaviors.some(b => b.type === "applyActiveEffect")) ) return;
    setTimeout(() => {
      syncZoneEffects(token).then(n => { if ( n ) log(`${token.name}: area effects realigned with its position (${n})`); })
        .catch(err => console.error(`${MODULE_ID} | area effects`, err));
    }, 1000);
  }, { executor: true, label: "area: carried effects not realigned" });
  // A move stopped between two chunks (`stopMovement`, called on all clients, documents/token.mjs:792): the cells
  // already traveled count.
  route("stopToken", settleCrossings, trigger);
  route("updateRegion", onUpdateRegion, trigger);
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "damage: dice multiplied (area), type chosen" });
}
