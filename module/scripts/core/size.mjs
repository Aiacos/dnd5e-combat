/**
 * Changing size (SPEC §16.58): "the target's size increases by one category — from Medium to Large, for example"
 * (Enlarge/Reduce). The categories in dnd5e's order (`CONFIG.DND5E.actorSizes.orderedKeys`: tiny, sm,
 * med, lg, huge, grg), clamped at the extremes.
 */

/**
 * @param {string} size             current category
 * @param {number} steps            steps (+1: one category up)
 * @param {string[]} orderedKeys    categories, from smallest to largest
 * @returns {string|null}  the new category, or null if the current size is unknown
 */
export function shiftSize(size, steps, orderedKeys) {
  const i = orderedKeys.indexOf(size);
  if ( i < 0 ) return null;
  return orderedKeys[Math.min(orderedKeys.length - 1, Math.max(0, i + steps))];
}
