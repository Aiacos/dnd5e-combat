/**
 * Undead Fortitude (Monster Manual 2024, §61): when damage reduces the creature to 0 HP, it makes a
 * Constitution saving throw with a DC of 5 + the damage taken, unless that damage is Radiant or comes from a Critical Hit;
 * on a success, it stays at 1 HP. Pure functions, no dependency on Foundry.
 */

/** What the rule does not allow: damage of this type. */
export const FORTITUDE_BREAKERS = Object.freeze(["radiant"]);

/** The base DC, to which the damage taken is added. */
export const FORTITUDE_BASE_DC = 5;

/**
 * The saving throw this damage calls for, or null.
 * @param {object} hit
 * @param {number} hit.hp         HP before the damage (excluding Temporary Hit Points).
 * @param {number} hit.through    Damage that gets past Temporary Hit Points (after Resistances).
 * @param {number} hit.taken      Damage taken (after Resistances, Temporary Hit Points included): it sets the DC.
 * @param {string[]} [hit.types]  Types of the damage taken.
 * @param {boolean} [hit.critical]
 * @returns {{ability: "con", dc: number}|null}
 */
export function fortitudeSave({ hp, through, taken, types=[], critical=false }) {
  if ( !(hp > 0) || !(through >= hp) || !(taken > 0) ) return null;   // does not drop to 0 HP (or was already there)
  if ( critical || types.some(t => FORTITUDE_BREAKERS.includes(t)) ) return null;
  return { ability: "con", dc: FORTITUDE_BASE_DC + Math.floor(taken) };
}
