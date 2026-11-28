/**
 * §369 (GitHub issue #27): flanking, an optional rule of the 2014 DMG (absent from the 2024 DMG) — off by default.
 * A creature and one of its allies in contact with an enemy, on opposite sides of it, have Advantage on their melee attacks
 * against it. "Opposite sides": the line joining the center of a cell of one to the center of a cell of the other crosses two
 * opposite sides (or two opposite corners) of the enemy's space; for a Large or larger creature, it is enough that one of its
 * cells qualifies.
 *
 * Square grid only. Spaces are rectangles IN CELLS ({x, y, w, h}: top-left corner, width, height); contact in height (elevation)
 * is judged separately, in 3D, by the adapter. Pure: no dependency on Foundry.
 */

const EPS = 1e-6;

/** The modes of the `flanking` setting. */
export const FLANKING_MODES = Object.freeze(["off", "advantage"]);
/** Who benefits (`flankingSide` setting): everyone, PCs only, NPCs only. */
export const FLANKING_SIDES = Object.freeze(["all", "pc", "npc"]);

/** The center of each cell of a space (at least half a cell for a Tiny creature). */
export function cellCenters({ x, y, w=1, h=1 }) {
  const offsets = size => ((size < 1) ? [size / 2] : Array.from({ length: Math.max(1, Math.round(size)) }, (_, k) => k + 0.5));
  return offsets(h).flatMap(oy => offsets(w).map(ox => ({ x: x + ox, y: y + oy })));
}

/** Does the cell centered on `c` touch the space `box` (side or corner), without overlapping it? */
export function touchesBox(c, box) {
  const gapX = Math.max(box.x - (c.x + 0.5), (c.x - 0.5) - (box.x + box.w));
  const gapY = Math.max(box.y - (c.y + 0.5), (c.y - 0.5) - (box.y + box.h));
  if ( (gapX > EPS) || (gapY > EPS) ) return false;
  return (gapX > -EPS) || (gapY > -EPS);   // strict overlap on both axes: the cell is inside the space
}

/**
 * Does the segment p → q cross the space `box` from one side to the opposite side (or from a corner to the opposite corner)?
 * Liang–Barsky clipping, then the sides touched at entry and at exit.
 */
export function crossesOpposite(p, q, box) {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = 0, t1 = 1;
  const clip = (pk, qk) => {
    if ( Math.abs(pk) < EPS ) return qk >= -EPS;
    const r = qk / pk;
    if ( pk < 0 ) { if ( r > t1 ) return false; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return false; if ( r < t1 ) t1 = r; }
    return true;
  };
  const x0 = box.x, x1 = box.x + box.w, y0 = box.y, y1 = box.y + box.h;
  if ( !clip(-dx, p.x - x0) || !clip(dx, x1 - p.x) || !clip(-dy, p.y - y0) || !clip(dy, y1 - p.y) ) return false;
  if ( (t1 - t0) < EPS ) return false;   // ne fait qu'effleurer un coin
  const sides = t => {
    const x = p.x + (t * dx), y = p.y + (t * dy);
    return { L: Math.abs(x - x0) < EPS, R: Math.abs(x - x1) < EPS, T: Math.abs(y - y0) < EPS, B: Math.abs(y - y1) < EPS };
  };
  const a = sides(t0), b = sides(t1);
  return (a.L && b.R) || (a.R && b.L) || (a.T && b.B) || (a.B && b.T);
}

/**
 * Do two creatures flank this enemy? Each must have at least one cell in contact with its space, and a pair of those cells
 * must be on opposite sides.
 * @param {{x:number,y:number,w:number,h:number}} target
 * @param {{x:number,y:number,w:number,h:number}} a
 * @param {{x:number,y:number,w:number,h:number}} b
 */
export function flanks(target, a, b) {
  const near = space => cellCenters(space).filter(c => touchesBox(c, target));
  const ca = near(a), cb = near(b);
  return ca.some(p => cb.some(q => crossesOpposite(p, q, target)));
}

/**
 * Does the setting let this attacker benefit from flanking?
 * @param {{mode: string, side: string, attackerIsPc: boolean}} options
 */
export function flankingApplies({ mode, side="all", attackerIsPc }) {
  if ( mode !== "advantage" ) return false;
  if ( side === "pc" ) return !!attackerIsPc;
  if ( side === "npc" ) return !attackerIsPc;
  return true;
}
