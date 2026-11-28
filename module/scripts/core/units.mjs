/**
 * Length conversion, without dependency on Foundry (SPEC §5.7).
 * `factors[u]` is the length of a unit `u` in a common reference unit
 * (dnd5e: the foot). Converting means going through this reference.
 */

/**
 * @param {number} value
 * @param {string} from
 * @param {string} to
 * @param {Record<string, number>} factors
 * @returns {number}
 */
export function convertLength(value, from, to, factors) {
  if ( from === to ) return value;
  const a = factors[from];
  const b = factors[to];
  if ( !Number.isFinite(a) || !Number.isFinite(b) ) {
    throw new Error(`Unknown length unit: ${Number.isFinite(a) ? to : from}`);
  }
  return value * a / b;
}

/**
 * Is a distance measured on the scene within a range expressed in another unit?
 * dnd5e converts in simplified form (5 ft = 1.5 m, factor 10/3): 30 ft are exactly 9 m.
 * The epsilon absorbs only floating-point error, not one cell more.
 * @param {{value: number, units: string}} measured   measured distance, grid unit
 * @param {{value: number, units: string}} range      range of the activity
 * @param {Record<string, number>} factors
 */
export function isWithinRange(measured, range, factors) {
  const limit = convertLength(range.value, range.units, measured.units, factors);
  return measured.value <= limit + 1e-6;
}
