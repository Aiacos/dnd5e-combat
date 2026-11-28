/**
 * §95: rising at 0 HP (key `atZero`) — Necrotic Husk (Undead Patron: Unholy Resurrection), Shadow's Power (Strength of the
 * Grave), Ancestral Power (Persistent Fury, under Savage Fury). The item, its rule and its activity, as long as the creature
 * is at 0 HP, not dead, there is enough to pay and the condition holds; a creature that has already decided (refused, failed) is
 * noted until its HP go back up.
 */

import { contentOf } from "./content.mjs";
import { carriesEffectFrom } from "./facts.mjs";
import { usesLeftFor } from "./inspiration.mjs";

const settled = new Set();
const pending = new Set();

/** The question or the save is in progress: the creature does not fall yet (adapter/death.mjs). */
export const beginRise = actor => pending.add(actor.uuid);
export const endRise = actor => pending.delete(actor.uuid);
/** May rise: an available rule, or a decision in progress. */
export const risingAtZero = actor => !!actor && (pending.has(actor.uuid) || !!riseAtZeroOf(actor));

/** The creature has decided (risen, refused, save failed): no more questions until its HP go back up. */
export const settleRise = actor => settled.add(actor.uuid);
export const resetRise = actor => settled.delete(actor.uuid);

/** @returns {{item: Item5e, rule: object, activity: Activity}|null} */
export function riseAtZeroOf(actor) {
  if ( !actor || settled.has(actor.uuid) || actor.statuses?.has("dead") ) return null;
  if ( (actor.system?.attributes?.hp?.value ?? 1) > 0 ) return null;
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.atZero;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    if ( rule.whileEffect && !carriesEffectFrom(actor, rule.whileEffect) ) continue;
    return { item, rule, activity };
  }
  return null;
}
