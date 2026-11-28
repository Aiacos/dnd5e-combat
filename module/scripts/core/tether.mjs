/**
 * Link between a caster and a creature (SPEC §16.43, `tether` key of core/content.mjs): Witch Bolt — "on each of your
 * following turns, you can take a Bonus Action to automatically deal 1d12 lightning damage to the target, even if
 * the first attack missed; the spell ends as soon as the target leaves its range or has Total Cover from
 * you". Pure functions.
 */

/**
 * Does the link break? "its range": beyond `maxRange` (same unit as `distance`); "Total Cover".
 * @param {{distance: number|null, maxRange: number|null, totalCover: boolean}} state
 * @returns {"range"|"cover"|null}
 */
export function tetherBreak({ distance, maxRange, totalCover }) {
  if ( Number.isFinite(distance) && Number.isFinite(maxRange) && (distance > maxRange + 1e-6) ) return "range";
  if ( totalCover ) return "cover";
  return null;
}
