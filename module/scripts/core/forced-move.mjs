/**
 * A Reaction that shortens a forced movement (content key `reducesForcedMove`: Dwarven Plate — "if an effect moves you against
 * your will along the ground, you can use your Reaction to reduce the distance by up to 10 feet"). Pure functions.
 */

/**
 * By how much the rule can shorten this movement: at most its distance, never more than the movement itself. Different
 * units: nothing (the rule is declared in the unit of the content's pushes).
 * @param {{distance: number, units: string}|null|undefined} rule
 * @param {number} distance  The movement undergone.
 * @param {string} units     Its unit.
 */
export function braceCut(rule, distance, units) {
  if ( !rule || !(rule.distance > 0) || !(distance > 0) || (rule.units !== units) ) return 0;
  return Math.min(rule.distance, distance);
}

/** The errors of the key. Empty = valid. */
export function validateReducesForcedMove(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && Number.isFinite(rule.distance) && (rule.distance > 0)
    && (typeof rule.units === "string") && rule.units && Object.keys(rule).every(k => ["distance", "units"].includes(k));
  return ok ? [] : [`${at}reducesForcedMove: { distance, units }`];
}
