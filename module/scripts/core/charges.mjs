/**
 * Use Magic Device (Rogue, Thief 13 — SRD 5.2), Charges: "whenever you use a magic item property that expends charges,
 * roll 1d6; on a 6, you use the property without expending the charges". Pure functions.
 */

/**
 * Does this activity expend charges of a magic item? A magic item that is not a consumable (a potion drunk, a
 * scroll read are not charges), whose activity consumes its own uses, and which has several or
 * regains them.
 * @param {object} use
 * @param {boolean} use.magical      the item is magical
 * @param {boolean} use.consumable   the item is a consumable
 * @param {number} use.usesMax       its maximum uses
 * @param {boolean} use.recovers     it regains uses (at dawn…)
 * @param {Array<{type: string, target?: string}>} use.targets  the consumptions of the activity
 * @param {string} use.itemId
 */
export function spendsCharges({ magical, consumable, usesMax, recovers, targets, itemId }) {
  if ( !magical || consumable || !((usesMax > 1) || recovers) ) return false;
  return (targets ?? []).some(t => (t.type === "itemUses") && (!t.target || (t.target === itemId)));
}

/** Does the die keep the charges? */
export function chargesKept(roll, rule) {
  return Number.isFinite(roll) && (roll >= (rule?.on ?? Infinity));
}
