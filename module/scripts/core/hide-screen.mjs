/**
 * Naturally Stealthy (Halfling, SRD 5.2): "you can take the Hide action even when you are obscured only by a
 * creature that is at least one size larger than you". To hide, the engine requires that no enemy sees you; a creature does not
 * block sight. For the bearer of this trait, an enemy whose line of sight passes through the space of such a creature no longer
 * counts. Pure functions: points and rectangles in pixels.
 */

const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];

/** Is `size` at least `steps` sizes above `than`? Unknown size: no. */
export function largerBy(size, than, steps=1) {
  const a = SIZES.indexOf(size), b = SIZES.indexOf(than);
  return (a >= 0) && (b >= 0) && (a - b >= steps);
}

/** Le segment [p, q] traverse-t-il le rectangle (bords compris) ? Liang–Barsky. */
export function segmentCrossesRect(p, q, rect) {
  const dx = q.x - p.x, dy = q.y - p.y;
  let t0 = 0, t1 = 1;
  for ( const [d, lo, hi, o] of [[dx, rect.x, rect.x + rect.width, p.x], [dy, rect.y, rect.y + rect.height, p.y]] ) {
    if ( d === 0 ) { if ( (o < lo) || (o > hi) ) return false; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if ( a > b ) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if ( t0 > t1 ) return false;
  }
  return true;
}

const center = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/**
 * Does the observer see the bearer only through a creature at least one size larger than them? The line from one center to
 * the other must cross the space of that creature.
 * @param {{x: number, y: number, width: number, height: number}} observer  the observer's space
 * @param {{rect: object, size: string}} hider                             the space and size of whoever hides
 * @param {Array<{rect: object, size: string}>} bodies                     the other standing creatures in the scene
 */
export function screenedByLarger(observer, hider, bodies) {
  const from = center(observer), to = center(hider.rect);
  return (bodies ?? []).some(b => largerBy(b.size, hider.size) && segmentCrossesRect(from, to, b.rect));
}
