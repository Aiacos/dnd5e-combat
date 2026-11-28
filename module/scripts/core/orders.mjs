/**
 * Imposed order (SPEC §16.59): Command — "the target must succeed on a Wisdom saving throw or follow the command on its
 * next turn". The PHB 2024 commands and what each imposes on the target's turn:
 *
 *   approach  Approach: it moves toward you by the shortest path; its turn ends if it arrives within 1.5 m
 *   drop      Drop: it drops what it holds, and its turn ends
 *   flee      Flee: it spends its turn moving away from you by the fastest means
 *   grovel    Grovel: it falls Prone, and its turn ends
 *   halt      Halt: it does not move and takes no action or Bonus Action
 *
 * A turn "ended": no more action, Bonus Action or movement; the Reaction remains (outside its turn).
 */

export const ORDERS = Object.freeze(["approach", "drop", "flee", "grovel", "halt"]);

/**
 * @param {string} order
 * @returns {{move: "toward"|"away"|null, prone: boolean, drop: boolean, ends: "always"|"ifArrived"|"never"}|null}
 */
export function orderPlan(order) {
  switch ( order ) {
    case "approach": return { move: "toward", prone: false, drop: false, ends: "ifArrived" };
    case "drop": return { move: null, prone: false, drop: true, ends: "always" };
    case "flee": return { move: "away", prone: false, drop: false, ends: "always" };
    case "grovel": return { move: null, prone: true, drop: false, ends: "always" };
    case "halt": return { move: null, prone: false, drop: false, ends: "always" };
    default: return null;
  }
}

/**
 * Gap in cells between two footprints `{ i, j, w, h }` (diagonal = 1 cell); 0 on contact, -1 if they overlap.
 * `i` is the row and `j` the column (`grid.getOffset`): `i` goes with the height `h`, `j` with the width `w`.
 */
export function footprintDistance(a, b) {
  const di = Math.max(b.i - (a.i + a.h), a.i - (b.i + b.h));
  const dj = Math.max(b.j - (a.j + a.w), a.j - (b.j + b.w));
  if ( (di < 0) && (dj < 0) ) return -1;
  return Math.max(di, dj, 0);
}

/**
 * The cells (top-left corner) where to place a footprint `size` ({ w, h }) at `gap` cells from `anchor` ({ i, j, w, h }), within
 * `bounds` ({ i0, j0, i1, j1 }, inclusive bounds). `gap` 0: on contact (Approach); more: as far (Flee).
 */
export function cellsAtGap(anchor, size, gap, bounds) {
  const out = [];
  for ( let i = anchor.i - size.h - gap; i <= anchor.i + anchor.h + gap; i++ ) {
    for ( let j = anchor.j - size.w - gap; j <= anchor.j + anchor.w + gap; j++ ) {
      if ( (i < bounds.i0) || (j < bounds.j0) || ((i + size.h - 1) > bounds.i1) || ((j + size.w - 1) > bounds.j1) ) continue;
      if ( footprintDistance({ i, j, ...size }, anchor) === gap ) out.push({ i, j });
    }
  }
  return out;
}

/**
 * §403: Compulsion — "a horizontal direction" designated by the caster; the eight of the grid (`n` = toward the top of the scene).
 * `{ di, dj }`: step in rows (i, downward) and in columns (j, rightward) — the core's grid offsets.
 */
export const DIRECTIONS = Object.freeze({
  n: { di: -1, dj: 0 }, ne: { di: -1, dj: 1 }, e: { di: 0, dj: 1 }, se: { di: 1, dj: 1 },
  s: { di: 1, dj: 0 }, sw: { di: 1, dj: -1 }, w: { di: 0, dj: -1 }, nw: { di: -1, dj: -1 }
});

/**
 * §403: the cell targeted by "as much movement as possible in that direction" — `cells` steps from `cell`, bounded to the
 * scene (`bounds`: { rows, columns }; i from 0 to rows-1, j from 0 to columns-1). Null if the direction is unknown or has no steps.
 * @param {{i: number, j: number}} cell
 * @param {string} dir
 * @param {number} cells
 * @param {{rows: number, columns: number}} [bounds]
 */
export function directionTarget(cell, dir, cells, bounds=null) {
  const d = DIRECTIONS[dir];
  if ( !d || !(cells > 0) ) return null;
  let steps = Math.floor(cells);
  if ( bounds ) {
    const room = (v, dv, size) => (dv > 0) ? (size - 1 - v) : (dv < 0) ? v : Infinity;
    steps = Math.min(steps, room(cell.i, d.di, bounds.rows), room(cell.j, d.dj, bounds.columns));
  }
  if ( !(steps > 0) ) return null;
  return { i: cell.i + (d.di * steps), j: cell.j + (d.dj * steps) };
}
