/**
 * M8 (SPEC §18.17): Swallow / Engulf in play. Active GM.
 *  - the "swallowed" effect placed (the Behir's failed saving throw, the Frog's action): the grapple by the swallower ends (the
 *    text: "no longer Grappled"), the swallowed creature is placed at the center of the swallower's space, and follows it when
 *    it walks;
 *  - the damage each turn, at the moment the text says (core/swallow.mjs); the Frog spits it out after its own;
 *  - "if it takes 30 damage or more in a single turn from a creature inside": Constitution saving throw at the end of that
 *    turn, failed → all regurgitated, Prone, in contact;
 *  - the swallower dies: the swallowed creatures are freed, Prone, in contact.
 * §18.21: capacity ("only one creature at a time") and grappled target required when the effect is placed; "cannot use
 * Bite while it has swallowed"; Escape (item check, Gelatinous Cube; runtime/grapple.mjs); repeated saving throw at the
 * end of each turn of the swallowed creature (Blob); a swallowed creature that comes out otherwise (escape, saving throw,
 * end of the Mound's grapple) leaves the swallower's space; engulfing while walking (Cube, Blob): after the action, whoever
 * the cube passes through makes the saving throw.
 * §45: the Giant Toad, whose activities place no "swallowed" effect: at its action, the engine places it on the grappled
 * creature.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { swallowDamageNow, mustRegurgitateSave, enteredSpaces, fitsSize } from "../core/swallow.mjs";
import { swallowAgainst, resaveAgainst } from "../adapter/areas.mjs";
import { grappleEffectsOf, grapplerOf, actorOfEffect } from "../adapter/grapple.mjs";
import {
  swallowedBy, swallowedIn, swallowerOf, swallowedTokenOf, swallowItemOf, swallowOf, placeInside, carrySwallowed, release,
  releasing, moveOut, footprint, englishNameOf, swallowerTokenFor
} from "../adapter/swallow.mjs";
import { committedPosition, turnKeyAt } from "../adapter/turn.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { relaunchUse } from "./relaunch.mjs";

const turnKey = combat => (combat?.started ? `${combat.id}.${combat.round}.${combat.turn}` : "hors-combat");

/** The "swallowed" effect has just been placed. */
async function onSwallowed(effect) {
  const by = swallowedBy(effect);
  if ( !by ) return;
  const token = swallowedTokenOf(effect);
  const swallowerToken = token ? swallowerTokenFor(effect, by, token.parent) : null;
  if ( !token || !swallowerToken ) return;
  // §18.21: "only one creature swallowed at a time", "a target it is grappling" — otherwise the effect does not hold.
  const rule = by.rule;
  const others = swallowedIn(swallowerToken).filter(i => i.token !== token);
  const held = grappleEffectsOf(token.actor).some(g => (g.id !== effect.id) && (grapplerOf(g)?.uuid === by.swallower?.uuid));
  const refused = (rule.capacity && (others.length >= rule.capacity)) ? loc("Avale.Plein", { source: swallowerToken.name, n: rule.capacity })
    : ((rule.grappling && !held) ? loc("Avale.PasAgrippe", { source: swallowerToken.name, name: token.name }) : null);
  if ( refused ) {
    releasing.add(effect.uuid);
    try { await effect.delete(); }
    finally { releasing.delete(effect.uuid); }
    log(`${swallowerToken.name} doesn't swallow ${token.name}: ${refused}`);
    ui.notifications.info(refused);
    return;
  }
  await effect.setFlag(MODULE_ID, "swallow", { since: turnKey(game.combat) });
  // "which is no longer Grappled": the swallower's grapple ends (not the "swallowed" effect itself: Shambling Mound).
  for ( const grapple of grappleEffectsOf(token.actor) ) {
    if ( (grapple.id !== effect.id) && (grapplerOf(grapple)?.uuid === by.swallower?.uuid) ) await grapple.delete();
  }
  await placeInside(token, swallowerToken);
  log(`${swallowerToken.name} swallows ${token.name} (${by.rule.item.name})`);
}

/**
 * A "swallowed" effect removed otherwise than by the engine (escape, successful repeated saving throw, end of the Shambling
 * Mound's grapple): the creature leaves the swallower's space, standing.
 */
async function onRemoved(effect) {
  if ( releasing.has(effect.uuid) ) return;
  const by = swallowedBy(effect);
  if ( !by?.swallower ) return;
  const token = swallowedTokenOf(effect);
  const swallowerToken = token ? swallowerTokenFor(effect, by, token.parent) : null;
  if ( !token || !swallowerToken ) return;
  await moveOut(token, swallowerToken);
  log(`${token.name} leaves ${swallowerToken.name}`);
}

/**
 * Escaping from a swallower whose item carries an escape check (Gelatinous Cube: Athletics against its DC; Shambling Mound) —
 * called by the Escape action (runtime/grapple.mjs), on the client of whoever escapes. null: not swallowed, or nothing to
 * check; otherwise true if free.
 */
export async function escapeSwallow(actor) {
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const inside = token ? swallowerOf(token) : null;
  const check = inside?.rule.escape?.check;
  const dc = check?.dc?.value;
  if ( !inside || !Number.isFinite(dc) ) return null;
  const skill = Array.from(check.associated ?? [])[0] ?? "ath";
  const rolls = await actor.rollSkill({ skill, target: dc }, { configure: false });
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return false;
  const free = total >= dc;
  log(`${actor.name} ${free ? "escapes from" : "doesn't escape from"} ${inside.token.name} (${total} vs DC ${dc})`);
  ui.notifications.info(loc(free ? "Avale.Echappe" : "Avale.Rate", { name: actor.name, source: inside.token.name }));
  if ( free ) await release(token, inside.effect, inside.token, { prone: false });
  return free;
}

/** "it can't use Bite while it has a swallowed target" — refused, on the client that uses it. */
function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  const actor = activity?.actor;
  const rule = swallowItemOf(actor);
  if ( !rule?.forbids || (englishNameOf(activity.item).toLowerCase() !== rule.forbids.toLowerCase()) ) return;
  if ( usageConfig?.[MODULE_ID]?.swallowForced ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token || !swallowedIn(token).length ) return;
  // §412 (issue #44, batch 5): the legality window; forced, the same use restarts (the GM warned).
  askAnyway(`${activity.item.name} — ${token.name}`, [loc("Avale.Interdit", { source: token.name, item: activity.item.name })],
    { actor, item: activity.item, token }).then(go => {
    if ( go ) relaunchUse(activity, { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), swallowForced: true } }, dialogConfig, messageConfig);
  }).catch(err => console.error(`${MODULE_ID} | swallow: forced use`, err));
  return false;
}

/* -------------------------------------------- */
/*  Engloutir en marchant (Cube, Blob)          */
/* -------------------------------------------- */

/** Swallower → { turn, done }: the engulf action was used this turn; `done`: already targeted during this move. */
const engulfing = new Map();

/**
 * §45: the swallower whose activities place no "swallowed" effect (Giant Toad: "swallows a Medium or smaller target it
 * is grappling") has just used its action — the engine places the effect on the creature it grapples (the first that fits
 * under the stated size), and what follows is that of any swallowing (`onSwallowed`). Nothing to swallow: we say so.
 */
async function swallowHeld(activity, rule) {
  const actor = activity.actor;
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token ) return;
  if ( rule.capacity && (swallowedIn(token).length >= rule.capacity) ) {
    return ui.notifications.info(loc("Avale.Plein", { source: token.name, n: rule.capacity }));
  }
  const held = token.parent.tokens.filter(t => (t !== token) && t.actor && !t.actor.statuses.has("dead")
    && grappleEffectsOf(t.actor).some(g => grapplerOf(g)?.uuid === actor.uuid));
  const fitting = held.filter(t => fitsSize(t.actor.system.traits?.size, rule.targetMaxSize));
  if ( !fitting.length ) {
    const text = held.length ? loc("Avale.TropGrand", { source: token.name, name: held[0].name }) : loc("Avale.Personne", { source: token.name });
    log(`${token.name} swallows nothing: ${text}`);
    return ui.notifications.info(text);
  }
  await placeItemEffect(rule.item, rule.effectId, fitting[0].actor);
}

function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") ) return;
  const activity = message.getAssociatedActivity?.();
  const rule = swallowOf(activity?.item);
  if ( rule && !rule.entryPoses && rule.effectId && (activity === rule.entry) ) return swallowHeld(activity, rule);
  if ( !rule?.moving || (activity !== rule.entry) ) return;
  const actor = activity.actor;
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token ) return;
  engulfing.set(token.uuid, { turn: turnKey(game.combat), done: new Set() });
  log(`${token.name}: ${rule.item.name} - those whose space it enters will make a saving throw`);
}

/** Positions along the path, one sample every half cell (start included). */
function sampledPath(token, movement) {
  const points = [movement.origin, ...(movement.passed?.waypoints ?? []), movement.destination].filter(p => p && Number.isFinite(p.x));
  const step = Math.min(token.parent.grid.sizeX, token.parent.grid.sizeY) / 2;
  const out = [];
  for ( let i = 0; i < points.length; i++ ) {
    const a = points[i];
    const b = points[i + 1];
    out.push(footprint(token, a));
    if ( !b ) break;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for ( let k = 1; k < n; k++ ) out.push(footprint(token, { x: a.x + ((b.x - a.x) * k / n), y: a.y + ((b.y - a.y) * k / n) }));
  }
  return out;
}

async function engulfAlong(token, movement) {
  const state = engulfing.get(token.uuid);
  if ( !state || (state.turn !== turnKey(game.combat)) ) return;
  const rule = swallowItemOf(token.actor);
  if ( !rule?.entry ) return;
  const inside = new Set(swallowedIn(token).map(i => i.token.id));
  const candidates = token.parent.tokens.filter(t => (t !== token) && t.actor && !t.hidden && !isObjectToken(t) && !state.done.has(t.id) && !inside.has(t.id)
    && !t.actor.statuses.has("dead") && fitsSize(t.actor.system.traits?.size, rule.maxSize));
  const ids = enteredSpaces(sampledPath(token, movement), candidates.map(t => ({ id: t.id, ...footprint(t) })));
  if ( !ids.length ) return;
  const targets = candidates.filter(t => ids.includes(t.id));
  for ( const t of targets ) state.done.add(t.id);
  log(`${token.name} moves through ${targets.map(t => t.name).join(", ")}: ${rule.item.name}`);
  await swallowAgainst(rule.entry, token, targets, "engulf", { event: "engulf", flavor: "DND5ECOMBAT.Avale.Engloutit" });
}

/** The swallower has walked: its swallowed creatures follow. */
async function onMove(token, movement, operation) {
  if ( operation?.[MODULE_ID]?.dragged ) return;
  await engulfAlong(token, movement);
  const passed = movement.passed?.waypoints ?? [];
  const from = movement.origin ?? passed[0];
  if ( !from || !swallowedIn(token).length ) return;
  const to = committedPosition(token);
  await carrySwallowed(token, to.x - from.x, to.y - from.y, (to.elevation ?? 0) - (from.elevation ?? 0));
}

/* -------------------------------------------- */
/*  Damage from inside: regurgitate             */
/* -------------------------------------------- */

/** Damage taken by a swallower from its swallowed creatures, per turn: `${tour}|${avaleur}` → total. */
const fromInside = new Map();

function onApplyDamage(actor, amount, options) {
  if ( !(amount > 0) ) return;
  const message = options?.originatingMessage ?? options?.origin ?? null;
  const attacker = message?.getAssociatedActor?.() ?? null;
  const token = attacker?.getActiveTokens?.(false, true)?.[0] ?? null;
  const inside = token ? swallowerOf(token) : null;
  if ( !inside || (inside.token.actor !== actor) ) return;
  const key = `${turnKey(game.combat)}|${actor.uuid}`;
  fromInside.set(key, (fromInside.get(key) ?? 0) + amount);
  log(`${actor.name}: ${amount} damage from ${attacker.name}, from inside (${fromInside.get(key)} this turn)`);
}

/** End of a turn: each swallower that has taken enough damage from inside makes a saving throw, or regurgitates everything. */
async function regurgitateChecks(combat, prior) {
  const priorKey = turnKeyAt(combat, prior);
  for ( const [key, total] of Array.from(fromInside) ) {
    if ( !key.startsWith(`${priorKey}|`) ) continue;
    fromInside.delete(key);
    const actor = fromUuidSync(key.slice(priorKey.length + 1), { strict: false });
    const rule = swallowItemOf(actor);
    if ( !rule?.regurgitate || !mustRegurgitateSave(rule.threshold, total) ) continue;
    const swallowerToken = actor.token ?? actor.getActiveTokens?.(false, true)?.[0];
    const dc = rule.regurgitate.save.dc.value;
    const ability = rule.regurgitate.save.ability?.first?.() ?? Array.from(rule.regurgitate.save.ability ?? ["con"])[0];
    const rolls = await actor.rollSavingThrow({ ability, target: dc }, { configure: false });
    const result = rolls?.[0]?.total ?? rolls?.total ?? null;
    const kept = (result !== null) && (result >= dc);
    log(`${actor.name}: ${total} damage from inside this turn - saving throw ${result} vs DC ${dc}: ${kept ? "keeps" : "regurgitates"}`);
    if ( kept || !swallowerToken ) continue;
    for ( const { token, effect } of swallowedIn(swallowerToken) ) await release(token, effect, swallowerToken);
  }
}

/* -------------------------------------------- */
/*  Damage each turn                            */
/* -------------------------------------------- */

async function damageAt(combat, prior, current) {
  const ended = combat.combatants.get(prior?.combatantId)?.token ?? null;
  const started = combat.combatants.get(current?.combatantId)?.token ?? null;
  const priorKey = turnKeyAt(combat, prior);
  // The swallower's turn ends or starts.
  for ( const [owner, which] of [[ended, "ended"], [started, "started"]] ) {
    if ( !owner?.actor ) continue;
    const rule = swallowItemOf(owner.actor);
    if ( !rule?.damage ) continue;
    const inside = swallowedIn(owner).filter(({ effect }) => swallowDamageNow(rule.damageAt,
      { [which]: true, sameTurn: effect.getFlag(MODULE_ID, "swallow")?.since === priorKey }));
    if ( !inside.length ) continue;
    log(`${owner.name}: ${rule.item.name} - ${inside.map(i => i.token.name).join(", ")}`);
    await swallowAgainst(rule.damage, owner, inside.map(i => i.token), rule.damageAt);
  }
  // A swallowed creature's turn ends: "repeats the save at the end of each of its turns" (Blob) — if successful, the effect
  // drops (runtime/engine.mjs, resave brick) and the creature comes out (onRemoved).
  const out = ended ? swallowerOf(ended) : null;
  if ( out?.rule.repeatsSave && out.rule.entry ) {
    log(`${ended.name}, inside ${out.token.name}: repeated saving throw`);
    await resaveAgainst(out.effect, out.rule.entry, ended, "endOfTurn");
  }
  // A swallowed creature's turn starts (Kraken, Blob, Mound: "at the start of each of its turns").
  const holder = started ? swallowerOf(started) : null;
  if ( holder?.rule.damage && swallowDamageNow(holder.rule.damageAt, { targetStarted: true }) ) {
    log(`${started.name} starts their turn inside ${holder.token.name}: ${holder.rule.item.name}`);
    await swallowAgainst(holder.rule.damage, holder.token, [started], holder.rule.damageAt);
  }
}

/**
 * The Frog: "If that damage doesn't kill it, the frog disgorges it". The Cube: "Success: … the target moves to an
 * unoccupied space within 5 feet" — whoever succeeded and stands in its space comes out of it.
 */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const tick = game.messages.get(resolution.carrier)?.getFlag(MODULE_ID, "areaTick");
  if ( tick?.event === "engulf" ) {
    const swallowerToken = fromUuidSync(tick.source, { strict: false });
    for ( const t of resolution.targets ) {
      if ( t.save?.success !== true ) continue;
      const token = fromUuidSync(t.token, { strict: false });
      if ( token ) await moveOut(token, swallowerToken);
    }
    return;
  }
  if ( (tick?.event !== "swallow") || (tick.moment !== "ownerEndOnce") ) return;
  const swallowerToken = fromUuidSync(tick.source, { strict: false });
  for ( const { token, effect } of swallowedIn(swallowerToken) ) {
    if ( (token.actor?.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
    await release(token, effect, swallowerToken);
    log(`${swallowerToken.name} spits out ${token.name}`);
  }
}

/** The swallower dies: its swallowed creatures are freed. */
async function onDeath(effect) {
  if ( !effect.statuses?.has("dead") ) return;
  const actor = actorOfEffect(effect);
  const swallowerToken = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  for ( const { token, effect: swallowed } of swallowedIn(swallowerToken) ) {
    await release(token, swallowed, swallowerToken);
    log(`${actor.name} dies: ${token.name} is freed`);
  }
}

export function registerSwallow() {
  const executor = { executor: true };
  route("createActiveEffect", effect => Promise.all([onSwallowed(effect), onDeath(effect)]), { ...executor, label: "swallow: effect not tracked" });
  route("deleteActiveEffect", onRemoved, { ...executor, label: "swallow: the swallowed creature doesn't leave" });
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "swallow: Bite not refused" });
  route("createChatMessage", onUsage, { ...executor, label: "swallow / engulf: action not tracked" });
  route("moveToken", onMove, { ...executor, label: "swallow: the swallowed creatures don't follow" });
  route("dnd5e.applyDamage", onApplyDamage, { ...executor, label: "swallow: damage from inside not counted" });
  route("combatTurnChange", async (combat, prior, current) => {
    await regurgitateChecks(combat, prior);
    await damageAt(combat, prior, current);
  }, { ...executor, label: "swallow: turn not handled" });
  route(`${MODULE_ID}.resolution`, onResolution, { ...executor, label: "swallow: the frog doesn't spit out" });
}
