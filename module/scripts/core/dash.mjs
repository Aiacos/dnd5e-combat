/**
 * Straight-line rush (SPEC §57, `lineDash` key of core/content.mjs): the creature goes from its cell to the chosen cell in a
 * straight line, and whatever is near the spaces it crosses is subject to the activity (for example: any
 * creature within 1.50 m at most of a cell of its path). Here, the cells crossed, without Foundry.
 */

/**
 * The positions (top-left corner, in cells) of a footprint that slides in a straight line from `from` to `to`, start and end
 * included, without duplicates: the sampling is taken every quarter cell, and each position is the nearest cell.
 * @param {{i: number, j: number}} from
 * @param {{i: number, j: number}} to
 * @returns {{i: number, j: number}[]}
 */
export function straightCells(from, to) {
  const di = to.i - from.i;
  const dj = to.j - from.j;
  const n = Math.max(1, 4 * Math.max(Math.abs(di), Math.abs(dj)));
  const out = [];
  const seen = new Set();
  for ( let k = 0; k <= n; k++ ) {
    // Symmetric rounding (a half cell moves away from zero in both directions): the path does not depend on the direction.
    const cell = { i: from.i + nearest((di * k) / n), j: from.j + nearest((dj * k) / n) };
    const key = `${cell.i},${cell.j}`;
    if ( seen.has(key) ) continue;
    seen.add(key);
    out.push(cell);
  }
  return out;
}

const nearest = x => ((x < 0) ? -Math.round(-x) : Math.round(x)) + 0;
