/**
 * Is a target in range? Everything is converted into the grid unit before comparing
 * (SPEC §5.7): the world is metric, an item may have stayed in feet. Pure functions.
 */

import { convertLength } from "./units.mjs";

/**
 * @param {{value: number, units: string}} measured  Distance measured on the scene, grid unit.
 * @param {object} range
 * @param {number|null} range.value   Normal range (or reach, for a melee attack).
 * @param {number|null} [range.long]  Long range of a ranged weapon.
 * @param {string} range.units        Item unit ("ft", "m"…). The "self", "touch", "special" ranges have no value.
 * @param {Record<string, number>} factors
 * @returns {"outOfRange"|"longRange"|null}  null = in range, or range not measurable.
 */
export function rangeIssue(measured, range, factors) {
  if ( !Number.isFinite(range?.value) || !(range.units in factors) || !(measured.units in factors) ) return null;
  const near = convertLength(range.value, range.units, measured.units, factors);
  if ( measured.value <= near + 1e-6 ) return null;
  if ( Number.isFinite(range.long) ) {
    const far = convertLength(range.long, range.units, measured.units, factors);
    if ( measured.value <= far + 1e-6 ) return "longRange";
  }
  return "outOfRange";
}

/**
 * O8h (§351): a minimum range — "cannot hit a target 18 m or less from it" (Mangonel, Trebuchet, lobbed shot).
 * @param {{value: number, units: string}} measured  Distance measured, grid unit.
 * @param {{value: number, units: string}|null} min  The weapon's minimum range, or null.
 * @param {Record<string, number>} factors
 * @returns {boolean}  true if the target is too close (at the minimum range or less); false with no measurable minimum range.
 */
export function tooClose(measured, min, factors) {
  if ( !Number.isFinite(min?.value) || !(min.units in factors) || !(measured?.units in factors) ) return false;
  return measured.value <= convertLength(min.value, min.units, measured.units, factors) + 1e-6;
}
