/**
 * §403: Gust of Wind — "every meter moved toward you costs 2 m of movement" in the Line. The extra cost of a path:
 * for each step that starts or ends in the area and brings the creature closer to the caster, its cost once more. Pure.
 * @param {Array<{x: number, y: number, inside: boolean, cost?: number}>} points  Start, then each path point (`cost`: that of the
 *                                                                                  step leading to it).
 * @param {{x: number, y: number}} caster
 * @returns {number}
 */
export function windwardExtra(points, caster) {
  let extra = 0;
  const d = p => Math.hypot(p.x - caster.x, p.y - caster.y);
  for ( let i = 1; i < (points?.length ?? 0); i++ ) {
    const a = points[i - 1], b = points[i];
    if ( !(a.inside || b.inside) ) continue;
    if ( d(b) < d(a) - 1e-6 ) extra += Number(b.cost) || 0;
  }
  return extra;
}
