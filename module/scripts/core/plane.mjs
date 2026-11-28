/**
 * §225: the Ethereal Plane, simple version — dnd5e's `ethereal` status stands in for a plane, on the same map. A creature in
 * the Border Ethereal "can affect and be affected only by what is also on the Ethereal Plane" (Etherealness, Blink,
 * PHB 2024): no target, no attack, no Opportunity Attack, no Reaction, no area, no aura from one plane to the other, and cells
 * are not blocked. Batch 2: perception from one plane to the other (`perceivesAcross`). Batch 3: walls are crossed, except
 * those that stop ethereal travel (`crossesEtherealWall`), vertical movement costs double (`etherealStepCost`). Batch 4: the
 * return onto an occupied cell (`nearestFreeCell`, `shuntDamage`).
 *
 * Pure: no dependency on Foundry.
 */

export const ETHEREAL = "ethereal";

/**
 * The GM's switch (world setting `etherealPlane`, runtime/ethereal.mjs): off, every creature is on the Material Plane — dnd5e's
 * `ethereal` condition does nothing more than show its icon. Held here, with no import: A* and vision read it too.
 */
let enabled = true;
export const etherealPlaneOn = () => enabled;
export function setEtherealPlaneState(value) {
  enabled = value !== false;
}

/** A creature's plane from its statuses: "ethereal" or "material". Without statuses (a point, an object), the Material Plane. */
export function planeOf(statuses) {
  return (enabled && statuses?.has?.(ETHEREAL)) ? ETHEREAL : "material";
}

/** Two creatures (their statuses) on the same plane? What has no statuses (null) is on the Material Plane. */
export function samePlane(statusesA, statusesB) {
  return planeOf(statusesA) === planeOf(statusesB);
}

/**
 * §225, batch 2: can a creature perceive another from one plane to the other? Same plane: yes (the rest of the test decides).
 *  - from the Material to the Ethereal: only within range of an Ethereal sight (`etherealSight`: See Invisibility,
 *    Third Eye — unlimited —, Ethereal Sight 60 ft, "Supreme Vision" at its range; null: none);
 *  - from the Ethereal to the Material: "you perceive the plane you left … nothing beyond 60 ft" (`limit`);
 *  - `visibleAcross`: the target is seen from one plane to the other (the MM's ghost, "visible on the Material Plane … and
 *    vice versa").
 * Distances in the same unit.
 */
export function perceivesAcross({ observerPlane, targetPlane, distance, etherealSight=null, limit=Infinity, visibleAcross=false }) {
  if ( observerPlane === targetPlane ) return true;
  if ( visibleAcross ) return true;
  if ( targetPlane === ETHEREAL ) return (etherealSight !== null) && (distance <= etherealSight + 1e-6);
  return distance <= limit + 1e-6;
}

/** Do the segments [a, b] and [c, d] intersect (endpoints included)? Points `{ x, y }`. */
function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => Math.sign(((q.x - p.x) * (r.y - p.y)) - ((q.y - p.y) * (r.x - p.x)));
  const onSegment = (p, q, r) => (Math.min(p.x, q.x) <= r.x + 1e-9) && (r.x <= Math.max(p.x, q.x) + 1e-9)
    && (Math.min(p.y, q.y) <= r.y + 1e-9) && (r.y <= Math.max(p.y, q.y) + 1e-9);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if ( (o1 !== o2) && (o3 !== o4) ) return true;
  return ((o1 === 0) && onSegment(a, b, c)) || ((o2 === 0) && onSegment(a, b, d))
    || ((o3 === 0) && onSegment(c, d, a)) || ((o4 === 0) && onSegment(c, d, b));
}

/**
 * §225, batch 3: does a step in the Ethereal, from `from` to `to`, cross one of these walls (those that stop ethereal travel:
 * Wall of Force, Forcecage)? `walls`: segments `[x0, y0, x1, y1]`. All other walls are crossed.
 */
export function crossesEtherealWall(from, to, walls) {
  return walls.some(([x0, y0, x1, y1]) => segmentsCross(from, to, { x: x0, y: y0 }, { x: x1, y: y1 }));
}

/** §225, batch 3: "moving up or down costs 1 extra foot per foot" (Etherealness) — the cost of a step, its vertical part doubled. */
export function etherealStepCost(cost, verticalDistance) {
  return cost + Math.abs(verticalDistance);
}

/**
 * §225, batch 4: the free cell nearest to `start` (`{ i, j }`), ring by ring (Chebyshev), the nearest as the crow flies in
 * each ring — for the return from the Ethereal onto an occupied cell ("pushed to the nearest unoccupied space"). `isFree(cell)`;
 * `maxRings` bounds the search. Returns `{ i, j, rings }`, `rings` 0 if the starting cell is free, or null.
 */
export function nearestFreeCell(start, isFree, maxRings=10) {
  if ( isFree(start) ) return { i: start.i, j: start.j, rings: 0 };
  for ( let r = 1; r <= maxRings; r++ ) {
    const ring = [];
    for ( let di = -r; di <= r; di++ ) for ( let dj = -r; dj <= r; dj++ ) {
      if ( Math.max(Math.abs(di), Math.abs(dj)) === r ) ring.push({ i: start.i + di, j: start.j + dj, d: (di * di) + (dj * dj) });
    }
    ring.sort((a, b) => a.d - b.d);
    const found = ring.find(c => isFree({ i: c.i, j: c.j }));
    if ( found ) return { i: found.i, j: found.j, rings: r };
  }
  return null;
}

/** §225, batch 4: "Force damage equal to twice the number of feet" of movement taken on return (Etherealness). */
export function shuntDamage(feet) {
  return Math.max(0, Math.round(2 * feet));
}

/**
 * The light that a token carries (torch, spell) does not light the Material Plane while it is in the Ethereal: nothing it carries
 * acts there. The rules do not say so in so many words — "affect and be affected only by what is in the Ethereal"
 * (Etherealness); it is also what the Vision 5e module does. What to do with the token's PREPARED rays, in memory:
 *  - `shade`: it is Ethereal and emits — set its rays to zero;
 *  - `reprepare`: it no longer is and its rays are still at zero — have its data re-prepared (its real rays, as they
 *    are now: the earlier ones are not restored, the torch may have gone out meanwhile);
 *  - `refresh`: it no longer is and data preparation has already restored its rays — only its source is to be redone;
 *  - null: nothing.
 * @param {{ethereal: boolean, dim: number, bright: number, shaded?: boolean}} state  `shaded`: it had been turned off.
 * @returns {"shade"|"reprepare"|"refresh"|null}
 */
export function etherealLight({ ethereal, dim=0, bright=0, shaded=false }) {
  const emits = (dim > 0) || (bright > 0);
  if ( ethereal ) return emits ? "shade" : null;
  if ( !shaded ) return null;
  return emits ? "refresh" : "reprepare";
}
