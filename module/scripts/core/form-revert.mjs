/**
 * §498 (block B18) — change of form at will (`changesForm`, §76) limited in time, shared resources. Pure rules:
 *  - `revertAfter: { rounds | seconds, auto? }`: the duration of the form, in seconds of world time (a round = `roundTime`, 6 s;
 *    the core advances world time at each round of a combat, `Combat#nextRound`). `auto: false`: no automatic return,
 *    only the "Revert to your form" entry of the menu and a reminder to the GM when the duration has elapsed.
 *  - `shareSpellSlots: true`: spell slots spent under one form stay spent under the other (spent = max − remaining, per level
 *    and for pact magic; the new form keeps at most its own maximums).
 */

import { isObject } from "./content/shared.mjs";

/** The errors of `revertAfter` (suffixes to append after `changesForm.revertAfter`). Empty = valid. */
export function revertAfterErrors(r) {
  if ( !isObject(r) ) return [": { rounds } or { seconds }"];
  const errors = [];
  const has = ["rounds", "seconds"].filter(k => k in r);
  if ( has.length !== 1 ) errors.push(": exactly one of rounds, seconds");
  if ( ("rounds" in r) && !(Number.isInteger(r.rounds) && (r.rounds >= 1)) ) errors.push(".rounds: integer ≥ 1");
  if ( ("seconds" in r) && !(Number.isFinite(r.seconds) && (r.seconds > 0)) ) errors.push(".seconds: number > 0");
  if ( ("auto" in r) && (typeof r.auto !== "boolean") ) errors.push(".auto: boolean");
  for ( const key of Object.keys(r) ) if ( !["rounds", "seconds", "auto"].includes(key) ) errors.push(`.${key}: unknown key`);
  return errors;
}

/** The duration of `revertAfter` in seconds of world time (`roundTime`: the duration of a round), or null with no duration. */
export function revertSeconds(r, roundTime=6) {
  if ( !isObject(r) ) return null;
  if ( Number.isFinite(r.seconds) && (r.seconds > 0) ) return r.seconds;
  if ( Number.isInteger(r.rounds) && (r.rounds >= 1) ) return r.rounds * (Number(roundTime) > 0 ? Number(roundTime) : 6);
  return null;
}

/** Has the form exceeded its duration? `expiresAt`: world time noted at the change (null: no duration). */
export const formExpired = (expiresAt, now) => Number.isFinite(expiresAt) && Number.isFinite(now) && (now >= expiresAt);

/** The slot keys of a dnd5e `system.spells`: `spell1`…`spell9` and `pact`. */
const SLOT_KEY = /^(spell[1-9]|pact)$/;

/**
 * The slots of the new form when spent slots are shared: for each level where it has any (`max` > 0), its remaining =
 * max − spent by the old form at that level (at least 0). A level the old form does not have spends nothing.
 * @param {object} from  `system.spells` of the form left ({ spell1: { value, max }, … })
 * @param {object} to    `system.spells` of the form taken
 * @returns {Record<string, number>}  `{ "system.spells.spell1.value": n, … }`, only the levels that change
 */
export function sharedSlotUpdates(from, to) {
  const out = {};
  for ( const [key, slot] of Object.entries(to ?? {}) ) {
    if ( !SLOT_KEY.test(key) ) continue;
    const max = Number(slot?.max) || 0;
    if ( max <= 0 ) continue;
    const old = from?.[key];
    const spent = Math.max(0, (Number(old?.max) || 0) - (Number(old?.value) || 0));
    const value = Math.max(0, max - spent);
    if ( value !== Number(slot?.value) ) out[`system.spells.${key}.value`] = value;
  }
  return out;
}
