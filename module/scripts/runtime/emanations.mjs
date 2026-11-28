/**
 * M7 (SPEC §18.11): monsters' Emanations act over the course of the combat's turns. Active GM.
 *  - end of the bearer's turn (`ownTurnEnd`, Fire Aura): one card, all the creatures reached;
 *  - start of a creature's turn (`turnStart`, Stench): one card per Emanation that reaches it.
 * A successful save leaves the Immunity the text promises ("for 24 hours"), read at resolution.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { emanationTargets } from "../core/emanation.mjs";
import { emanationAgainst } from "../adapter/areas.mjs";
import { hasLineOfEffect } from "../adapter/cover.mjs";
import { emanationsOf, carriesEmanation, isImmuneTo, grantImmunity } from "../adapter/emanations.mjs";
import { regenerationOf } from "../adapter/regeneration.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { distanceBetween, turnKeyAt } from "../adapter/turn.mjs";
import { canSee } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { sideOf } from "../adapter/factions.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { samePlane } from "../adapter/plane.mjs";

const defeated = actor => actor.statuses.has("dead") || actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED);

/** Out of play for an Emanation: no actor, Hidden, dead, or a driven object (Spiritual Weapon). */
const outOfPlay = token => !token.actor || token.hidden || defeated(token.actor) || isObjectToken(token);

/** Who the Emanation `emanation` of `source` reaches among `tokens`. `dying`: the bearer has just died (`death`). */
function reached(source, emanation, tokens, { dying=false }={}) {
  let radius = lengthIn(emanation.radius, emanation.units, source.parent.grid.units);
  const statuses = source.actor.statuses;
  const inactive = !dying && (outOfPlay(source) || (emanation.active && INCAPACITATING.some(s => statuses.has(s))));
  const candidates = tokens.filter(t => t.parent === source.parent).map(t => {
    const out = (t === source) || outOfPlay(t) || !samePlane(source, t);   // §225: nor across planes
    const distance = out ? Infinity : distanceBetween(source, t).value;
    const near = distance <= radius + 1e-6;
    return {
      ...sideOf(t), token: t.uuid, distance, out,
      kin: near && emanation.kin && carriesEmanation(t.actor, emanation.key),
      immune: near && isImmuneTo(t.actor, emanation.key, source.uuid),
      lineOfEffect: near ? hasLineOfEffect(source, t) : null,
      sees: (near && emanation.sees) ? canSee(t, source) : null
    };
  });
  const wanted = new Set(emanationTargets({ ...sideOf(source), token: source.uuid, radius, affects: emanation.affects, inactive },
    candidates));
  return tokens.filter(t => wanted.has(t.uuid));
}

/** The same Emanation acts only once per moment and per turn (a turn replayed backwards does not relaunch it). */
const done = new Set();
function once(key) {
  if ( done.has(key) ) return false;
  done.add(key);
  if ( done.size > 500 ) done.delete(done.values().next().value);
  return true;
}

async function onTurnChange(combat, prior, current) {
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  const started = combat.combatants.get(current?.combatantId)?.token;
  if ( ended?.actor ) {
    const turn = turnKeyAt(combat, prior);
    for ( const emanation of emanationsOf(ended.actor).filter(e => e.on === "ownTurnEnd") ) {
      const targets = reached(ended, emanation, ended.parent.tokens.contents);
      if ( !targets.length || !once(`${turn}|${ended.uuid}|${emanation.key}|end`) ) continue;
      log(`emanation ${emanation.item.name} (${ended.name}), end of its turn: ${targets.map(t => t.name).join(", ")}`);
      await emanationAgainst(emanation.activity, ended, targets, "ownTurnEnd");
    }
  }
  if ( started?.actor && !outOfPlay(started) ) {
    const turn = `${combat.id}.${current.round}.${current.turn}`;
    // §95: at the start of the bearer's turn (Unsettling Aura of the "Hollow Guardian") — all the creatures reached, one card.
    for ( const emanation of emanationsOf(started.actor).filter(e => e.on === "ownTurnStart") ) {
      const targets = reached(started, emanation, started.parent.tokens.contents);
      if ( !targets.length || !once(`${turn}|${started.uuid}|${emanation.key}|ownStart`) ) continue;
      log(`emanation ${emanation.item.name} (${started.name}), start of its turn: ${targets.map(t => t.name).join(", ")}`);
      await emanationAgainst(emanation.activity, started, targets, "ownTurnStart");
    }
    for ( const source of started.parent.tokens ) {
      if ( (source === started) || !source.actor ) continue;
      for ( const emanation of emanationsOf(source.actor).filter(e => e.on === "turnStart") ) {
        if ( !reached(source, emanation, [started]).length || !once(`${turn}|${source.uuid}|${emanation.key}|start`) ) continue;
        log(`emanation ${emanation.item.name} (${source.name}): ${started.name} starts its turn inside`);
        await emanationAgainst(emanation.activity, source, [started], "turnStart");
      }
    }
  }
}

/**
 * §18.14: the Dead condition has just been set (by the engine, §17.1, or by dnd5e) — a `death` Emanation fires on its own, once
 * per death. dnd5e's automatic Dead on a creature that regenerates does not count (§18.13, it is removed).
 */
const exploded = new Set();
async function onCreateEffect(effect) {
  await startedEmanation(effect);
  const actor = actorOfEffect(effect);   // an unlinked token: the effect is in its ActorDelta
  if ( !actor || !effect.statuses?.has("dead") ) return;
  if ( effect.getFlag("dnd5e", "autoDowned") && regenerationOf(actor)?.survivesZero ) return;
  const source = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !source?.parent ) return;
  for ( const emanation of emanationsOf(actor).filter(e => e.on === "death") ) {
    const key = `${source.uuid}|${emanation.key}|${effect.id}`;
    if ( exploded.has(key) ) continue;
    exploded.add(key);
    const targets = reached(source, emanation, source.parent.tokens.contents, { dying: true });
    log(`emanation ${emanation.item.name} (${source.name}), on its death: ${targets.map(t => t.name).join(", ") || "nobody"}`);
    if ( targets.length ) await emanationAgainst(emanation.activity, source, targets, "death");
  }
}

/**
 * §447: an `atStart` Emanation also acts when its item's effect arrives on the bearer — "Savage Wrath", "when you
 * transform and at the start of each of your following turns". The effect may be on the actor or, transferred, on one of its items
 * (the enchantment and its companion effects: several effects arrive together, the Emanation only acts once within a few seconds).
 */
const started = new Map();
async function startedEmanation(effect) {
  const parent = effect?.parent;
  const actor = (parent?.documentName === "Item") ? parent.actor : actorOfEffect(effect);
  if ( !actor ) return;
  const item = originItemOf(effect);
  if ( !item ) return;
  const source = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !source?.parent || outOfPlay(source) ) return;
  for ( const emanation of emanationsOf(actor).filter(e => e.atStart && (e.item.uuid === item.uuid)) ) {
    const key = `${source.uuid}|${emanation.key}`;
    if ( (Date.now() - (started.get(key) ?? 0)) < 5000 ) continue;
    started.set(key, Date.now());
    const targets = reached(source, emanation, source.parent.tokens.contents);
    log(`emanation ${emanation.item.name} (${source.name}), as it starts: ${targets.map(t => t.name).join(", ") || "nobody"}`);
    if ( targets.length ) await emanationAgainst(emanation.activity, source, targets, "atStart");
  }
}

/**
 * §19.6: at 0 HP, a creature that changes form (second phase) does not receive the Dead condition — its "on death" Emanations
 * still fire, before the switch (a boss's explosion at 0 HP).
 */
export async function burstAtZero(actor) {
  const source = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !source?.parent ) return;
  // Once per drop: the caller (runtime/coven.mjs, `onZero`) only goes through once per creature and per drop.
  for ( const emanation of emanationsOf(actor).filter(e => e.on === "death") ) {
    const targets = reached(source, emanation, source.parent.tokens.contents, { dying: true });
    log(`emanation ${emanation.item.name} (${source.name}), at 0 HP: ${targets.map(t => t.name).join(", ") || "nobody"}`);
    if ( targets.length ) await emanationAgainst(emanation.activity, source, targets, "death");
  }
}

/** Decided resolution of an Emanation: each target that succeeded on its save receives the promised Immunity. */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const tick = game.messages.get(resolution.carrier)?.getFlag(MODULE_ID, "areaTick");
  if ( tick?.event !== "emanation" ) return;
  const source = fromUuidSync(tick.source, { strict: false });
  const emanation = source?.actor ? emanationsOf(source.actor).find(e => e.key === tick.key) : null;
  if ( !emanation?.immunity ) return;
  for ( const t of resolution.targets ) {
    if ( t.save?.success !== true ) continue;
    const token = fromUuidSync(t.token, { strict: false });
    await grantImmunity(token?.actor, emanation, source);
    log(`emanation ${emanation.item.name} (${source.name}): ${token?.name} immune for ${emanation.immunity.hours} h`);
  }
}

export function registerEmanations() {
  route("combatTurnChange", onTurnChange, { executor: true, label: "monster emanation" });
  route("createActiveEffect", onCreateEffect, { executor: true, label: "emanation on death" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "emanation: immunity after saving throw" });
}
