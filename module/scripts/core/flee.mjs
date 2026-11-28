/**
 * §147: fleeing through the Reaction (Dissonant Whispers) — what can be computed without Foundry.
 *
 * Pure functions, no dependency on Foundry.
 */

/**
 * The gaps to try, in cells, from farthest to nearest: "as far as its Speed allows" — the current gap plus the Speed in cells,
 * then one less each time a wall or an obstacle makes the targeted gap unreachable, down to one more than the current gap.
 * @param {number} from   The current gap (0: in contact).
 * @param {number} cells  The Speed, in cells.
 * @returns {number[]}
 */
export function fleeGaps(from, cells) {
  const out = [];
  for ( let gap = from + cells; gap > from; gap-- ) out.push(gap);
  return out;
}
