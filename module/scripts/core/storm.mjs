/**
 * §70: the storm of Call Lightning — pure geometry (no dependency on Foundry).
 */

/**
 * The point closest to `point` inside a circle (the cloud): the point itself if it is inside, otherwise its projection
 * onto the edge. "A point you can see under the cloud": the bolt does not fall outside the storm.
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number}} center
 * @param {number} radius
 * @returns {{x: number, y: number}}
 */
export function clampToCircle(point, center, radius) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const d = Math.hypot(dx, dy);
  if ( (d <= radius) || !(d > 0) ) return { x: point.x, y: point.y };
  return { x: center.x + ((dx / d) * radius), y: center.y + ((dy / d) * radius) };
}
