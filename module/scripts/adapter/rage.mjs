/**
 * The Barbarian's Rage (SPEC §22) read and written in dnd5e 6.0. The Rage item of the Player's Handbook carries a
 * transferred effect, disabled at rest (Bludgeoning / Piercing / Slashing resistances, melee damage bonus, Advantage on
 * Strength checks and saves); the "Expend Rage" activity enables it, for 10 minutes. dnd5e neither ends the Rage at the end
 * of the next turn for lack of having maintained it (2024 rule), nor when the barbarian is Incapacitated: the engine does.
 *
 * Seen in play on 2026-09-28: the engine applies the activity's effect like dnd5e's effects tray, as a COPY on the actor
 * (origin: the item, `_stats.duplicateSource`: the item's effect); the item's effect can also be enabled by hand
 * from the sheet. The Rage is active if either one is.
 */

import { MODULE_ID } from "../constants.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { contentOf } from "./content.mjs";
import { currentTurnKey } from "./turn.mjs";
import { comesFromItemEffect } from "./triggers.mjs";
import { originItemOf } from "./facts.mjs";

/** The actor's Rage item, its rule and its effect, or null. */
export function rageOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.rage;
    const effect = rule ? item.effects.get(rule.effect) : null;
    if ( effect ) return { item, rule, effect };
  }
  return null;
}

/**
 * The Rage's Active Effects: the copy on the actor, and the item's effect if it is really enabled.
 * §299 (pass C4): dnd5e 6.0.6 prepares an item effect carried by an activity ("activity effect": the Rage's, which "Expend
 * Rage" applies) as `transfer = disabled = false` in memory, whatever the data's state (dnd5e.mjs:6929, `isOnActivity`) — it is
 * never transferred to the actor. Reading `effect.disabled` made every barbarian look permanently in Rage ("no spells in
 * Rage", blind Rage active…). The item's effect therefore counts only if its data say it is active and it is no activity effect.
 */
function rageEffects(actor) {
  const rage = rageOf(actor);
  if ( !rage ) return [];
  const copies = Array.from(actor.effects ?? []).filter(e => !e.disabled
    && (comesFromItemEffect(e, rage.rule.effect) || (originItemOf(e) === rage.item)));
  const ownActive = (rage.effect._source?.disabled === false) && (rage.effect.system?.isOnActivity !== true);
  return ownActive ? [...copies, rage.effect] : copies;
}

/** L'acteur est-il en Rage ? */
export function isRaging(actor) {
  return rageEffects(actor).length > 0;
}

/** A content rule carried by one of the actor's items (Persistent Rage, Relentless Rage…), or null. */
export function barbarianRule(actor, key) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.[key];
    if ( rule ) return { item, rule };
  }
  return null;
}

/** Does the Rage end with this condition? Incapacitated (and what grants it); Unconscious only, with Persistent Rage. */
export function statusEndsRage(actor, statuses) {
  const list = barbarianRule(actor, "persistentRage") ? ["unconscious", "dead"] : INCAPACITATING;
  return [...statuses].some(s => list.includes(s));
}

/** Ends the Rage (the item's effect disabled). Returns true if it was active. */
export async function endRage(actor) {
  const effects = rageEffects(actor);
  if ( !effects.length ) return false;
  const copies = effects.filter(e => e.parent === actor).map(e => e.id).filter(id => actor.effects.has(id));
  if ( copies.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", copies);
  const own = effects.find(e => e.parent !== actor);
  if ( own ) await own.update({ disabled: true });
  return true;
}

/** The Rage has just been maintained (or taken) on this combat turn. */
export async function keepRage(actor) {
  const key = currentTurnKey();
  if ( key && actor?.isOwner && (actor.getFlag(MODULE_ID, "rageKept") !== key) ) await actor.setFlag(MODULE_ID, "rageKept", key);
}

/** The last time the Rage was maintained (turn key), or null. */
export const rageKeptOn = actor => actor?.getFlag(MODULE_ID, "rageKept") ?? null;

/** Relentless Rage: at 0 HP, in Rage, not dead; the item and its save activity. */
export function relentlessAtZero(actor) {
  if ( !isRaging(actor) || actor.statuses?.has("dead") ) return null;
  const found = barbarianRule(actor, "relentless");
  const activity = found ? found.item.system.activities?.get(found.rule.activity) : null;
  return activity ? { item: found.item, activity } : null;
}

/** Recklessness: the decision made this turn (true, false), or null if it has not been made yet. */
export function recklessChoice(actor) {
  const c = actor?.getFlag(MODULE_ID, "recklessTurn");
  return (c && (c.key === currentTurnKey())) ? c.reckless : null;
}

/**
 * Core#98: the options already taken of a one-option-per-Rage ability — the Active Effects that its activities placed on the
 * bearer (copies, not transferred, origin the item; they fall with the Rage: `duringRage.copiesEnd`).
 * @returns {ActiveEffect[]}
 */
export function rageOptionsTaken(item) {
  const actor = item?.actor;
  if ( !actor ) return [];
  return Array.from(actor.effects ?? []).filter(e => !e.transfer && !e.disabled && (originItemOf(e) === item));
}
