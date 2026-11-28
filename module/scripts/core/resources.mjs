/**
 * §410 (issue #44, batch 3): what is missing to use an activity — spell slot, uses, quantity. Pure: no
 * dependency on Foundry. The engine says it in the legality window (forceable: forcing = not spending what is missing).
 */

/**
 * Is a slot left to cast at this level? `slotKey`: the slot requested ("spell3", "pact"); without it, any
 * slot of this level or higher, pact included (what dnd5e's window would offer).
 * @param {Record<string, {value?: number, max?: number, level?: number}>} spells  `actor.system.spells`.
 * @param {number} level
 * @param {string|null} [slotKey]
 */
export function slotLeft(spells, level, slotKey=null) {
  if ( !spells ) return false;
  if ( slotKey ) return (Number(spells[slotKey]?.value) || 0) > 0;
  for ( let n = Math.max(1, Number(level) || 1); n <= 9; n++ ) if ( (Number(spells[`spell${n}`]?.value) || 0) > 0 ) return true;
  const pact = spells.pact;
  return !!pact && ((Number(pact.value) || 0) > 0) && ((Number(pact.level) || 0) >= (Number(level) || 1));
}

/**
 * The cost of a consumption, if it reads without a roll: an integer; a formula ("1d4") counts as 1 (we do not refuse in
 * advance what a roll could allow).
 */
export function plainCost(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 1;
}

/**
 * A spell waiting to be prepared: its method is prepared (`CONFIG.DND5E.spellcasting[…].prepares`: "spell", "pact"), it
 * is not a cantrip, and it is not prepared (`prepared`: 0 no, 1 yes, 2 always). A spell cast from an item or a linked
 * activity is not concerned: the caller does not submit it.
 * @param {{level?: number, prepares?: boolean, prepared?: number|boolean}} spell
 * @returns {boolean}
 */
export function awaitsPreparation({ level=0, prepares=false, prepared=0 }={}) {
  return !!prepares && ((Number(level) || 0) > 0) && !prepared;
}

/**
 * The "resource" reasons of a use, in order: `noSlot`, `noUses`, `noQuantity`, `unprepared`.
 * @param {object} use
 * @param {boolean} [use.slotMissing]    A slot to spend (casting or consumption) is missing.
 * @param {boolean} [use.usesShort]      Uses to spend are missing.
 * @param {boolean} [use.quantityShort]  A quantity to spend is missing, or the item used is used up.
 * @param {boolean} [use.unprepared]     A spell to prepare, not prepared.
 * @returns {string[]}
 */
export function resourceIssues({ slotMissing=false, usesShort=false, quantityShort=false, unprepared=false }) {
  return [slotMissing && "noSlot", usesShort && "noUses", quantityShort && "noQuantity", unprepared && "unprepared"].filter(Boolean);
}

/** A consumption that is missing: positive cost, more than what is left. */
export const isShort = t => (t.cost > 0) && (t.available < t.cost);
