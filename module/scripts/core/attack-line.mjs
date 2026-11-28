/**
 * #33 (continued): the line of sight drawn from the attacker to their target during targeting — cut into colored segments. Pure.
 *  - "clear" (green): the unobstructed part;
 *  - "cover" (orange): from the obstacle that gives Half or Three-Quarters Cover;
 *  - "blocked" (red): from the obstacle that gives Total Cover, or beyond the range (unreachable);
 *  - "unseen" (blue): the unobstructed part when the attacker does not see their target (Invisible, Hidden, in the dark).
 * Positions are fractions of the line (0: the attacker, 1: the target).
 */

const RANK = { clear: 0, unseen: 0, cover: 1, blocked: 2 };

/**
 * @param {object} state
 * @param {"none"|"half"|"threeQuarters"|"total"} state.degree   The target's Cover (preview).
 * @param {number|null} [state.obstacleAt]  Where the line meets what gives the Cover (0–1); absent: in the middle.
 * @param {number|null} [state.rangeEnd]    Where the range ends (0–1); null: the target is in range.
 * @param {boolean} [state.unreachable]     The whole line is unreachable (the approach does not get there).
 * @param {boolean} [state.unseen]          The attacker does not see the target.
 * @returns {Array<{from: number, to: number, kind: "clear"|"unseen"|"cover"|"blocked"}>}
 */
export function attackLineSegments({ degree="none", obstacleAt=null, rangeEnd=null, unreachable=false, unseen=false }) {
  const base = unseen ? "unseen" : "clear";
  if ( unreachable ) return [{ from: 0, to: 1, kind: "blocked" }];
  const clamp = t => Math.min(1, Math.max(0, t));
  const marks = [];
  if ( degree !== "none" ) marks.push({ at: clamp(obstacleAt ?? 0.5), kind: (degree === "total") ? "blocked" : "cover" });
  if ( Number.isFinite(rangeEnd) && (rangeEnd < 1) ) marks.push({ at: clamp(rangeEnd), kind: "blocked" });
  const cuts = [...new Set([0, ...marks.map(m => m.at), 1])].sort((a, b) => a - b);
  const segments = [];
  for ( let i = 0; i < cuts.length - 1; i++ ) {
    const from = cuts[i], to = cuts[i + 1];
    if ( to - from < 1e-9 ) continue;
    let kind = base;
    for ( const m of marks ) if ( (m.at <= from + 1e-9) && (RANK[m.kind] > RANK[kind]) ) kind = m.kind;
    const last = segments.at(-1);
    if ( last?.kind === kind ) last.to = to;
    else segments.push({ from, to, kind });
  }
  return segments;
}

/**
 * Where the segment [a, b] enters a rectangle (fraction 0–1), or null if it does not cross it (Liang–Barsky).
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function segmentEntry(a, b, rect) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for ( const [p, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.width - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.height - a.y]] ) {
    if ( p === 0 ) { if ( q < 0 ) return null; continue; }
    const r = q / p;
    if ( p < 0 ) { if ( r > t1 ) return null; if ( r > t0 ) t0 = r; }
    else { if ( r < t0 ) return null; if ( r < t1 ) t1 = r; }
  }
  return (t1 - t0 > 1e-9) ? t0 : null;
}
