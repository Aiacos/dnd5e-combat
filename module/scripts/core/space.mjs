/**
 * Space in three dimensions (SPEC §14.2, P2): a creature's height, the elevation slice
 * it occupies, the vertical gap between two slices, the elevation slice of an area of effect
 * from its shape, an area's point of origin. Pure functions, no dependency on Foundry.
 *
 * Units: elevations and area sizes are in the grid's unit (that of token
 * elevations), a token's depth in cells (`depth` of the V14 core, a token goes from
 * `elevation` to `elevation + depth × distance d'une case`, client/documents/token.mjs:3251).
 */

/**
 * A creature's height in cells. dnd5e 6 fills it in from the size when token synchronization
 * is active (`tokenSizeSync`, documents/actor/actor.mjs:428: width, height AND depth
 * = size); without it, or for a token imported from an earlier version, `depth` stays at 1, its
 * default value: a creature is then taken to be as tall as wide — a Large occupies a 10 ft
 * Cube. A depth set on the token (≠ 1, by hand or by dnd5e) takes precedence.
 * @param {{width?: number, height?: number, depth?: number}} size
 * @returns {number}
 */
export function depthOf({ width=1, height=1, depth=1 }={}) {
  if ( depth !== 1 ) return depth;
  return Math.max(1, width, height);
}

/**
 * Vertical slice occupied: from feet to head.
 * @param {{elevation?: number, depth?: number}} position  `depth` in cells (see `depthOf`).
 * @param {number} gridDistance  Distance of one cell, in the grid's unit.
 * @returns {{bottom: number, top: number}}
 */
export function verticalExtent({ elevation=0, depth=1 }={}, gridDistance) {
  return { bottom: elevation, top: elevation + (depth * gridDistance) };
}

/** Vertical gap between two slices: 0 when they overlap. */
export function verticalGap(a, b) {
  return Math.max(0, b.bottom - a.top, a.bottom - b.top);
}

/**
 * Elevation slice of an area of effect, from the shape declared by dnd5e
 * (`CONFIG.DND5E.areaTargetTypes`) and the origin elevation (the caster's, since the interface has no vertical
 * aiming — dnd5e only places the area flat, template-placement.mjs:138).
 *
 *  - Sphere (and circle): centered on the origin elevation, radius above and below;
 *  - Emanation (`radius`): around the caster's body, from the feet minus the radius to the head plus the radius;
 *  - Cube (and square): set on the origin elevation, as tall as wide;
 *  - cylinder: set, of the declared height (otherwise as tall as its diameter);
 *  - Cone: flat, but a Cone widens — it gets half its length above and below.
 *    Too wide near the origin, just right at the end: better to include too much (the GM cancels)
 *    than to forget a flying creature at the end of the Cone;
 *  - Line: flat, of the caster's thickness or its width, whichever is greater;
 *  - wall: set, of its height (otherwise its width); ring: set, of its height (otherwise like a Sphere).
 *
 * @param {{type: string, size?: number, width?: number, height?: number}} area  Grid unit.
 * @param {{elevation?: number, depth?: number}} origin  Caster position (`depth` in cells).
 * @param {number} gridDistance
 * @returns {{bottom: number, top: number}|null}  null: unknown shape or no size, nothing is touched.
 */
export function regionElevationFor({ type, size, width, height }, { elevation=0, depth=1 }={}, gridDistance) {
  const has = v => Number.isFinite(v) && (v > 0);
  const e = elevation;
  const body = depth * gridDistance;
  switch ( type ) {
    case "sphere":
    case "circle":
      return has(size) ? { bottom: e - size, top: e + size } : null;
    case "radius":
      return has(size) ? { bottom: e - size, top: e + body + size } : null;
    case "cube":
    case "square":
      return has(size) ? { bottom: e, top: e + size } : null;
    case "cylinder":
      return has(size) ? { bottom: e, top: e + (has(height) ? height : 2 * size) } : null;
    case "cone":
      return has(size) ? { bottom: e - (size / 2), top: e + (size / 2) } : null;
    case "line":
      return has(size) ? { bottom: e, top: e + Math.max(has(width) ? width : 0, body) } : null;
    case "wall":
      return has(size) ? { bottom: e, top: e + (has(height) ? height : (has(width) ? width : body)) } : null;
    case "ring":
      if ( !has(size) ) return null;
      return has(height) ? { bottom: e, top: e + height } : { bottom: e - size, top: e + size };
    default:
      return null;
  }
}

/**
 * Origin point of an area, in pixels, from its first shape (V14 core region shapes, common/data/data.mjs): center of a
 * circle or an ellipse, origin of a Cone, a Line or a ring, center of a rectangle (its origin offset by its anchor), origin or
 * center of mass of a polygon, origin of a "grid cells" shape (14.370) when it has one. For an Emanation, a token shape or an
 * unknown shape, `fallback` (the center of the origin token, which the adapter knows). A "hole" shape
 * (`hole`, a cell spared in a cautious Fireball) is never the origin: the first solid shape is taken.
 * @param {object[]} shapes
 * @param {{x: number, y: number}|null} fallback
 * @returns {{x: number, y: number}|null}
 */
export function originPointOfShapes(shapes, fallback=null) {
  const shape = shapes?.find(s => !s?.hole);
  if ( !shape ) return fallback;
  switch ( shape.type ) {
    case "grid":
      return (shape.origin && Number.isFinite(shape.origin.x) && Number.isFinite(shape.origin.y))
        ? { x: shape.origin.x, y: shape.origin.y } : fallback;
    case "circle":
    case "ellipse":
    case "cone":
    case "line":
    case "ring":
      return { x: shape.x, y: shape.y };
    case "rectangle":
      return { x: shape.x + ((0.5 - (shape.anchorX ?? 0)) * shape.width), y: shape.y + ((0.5 - (shape.anchorY ?? 0)) * shape.height) };
    case "polygon": {
      if ( shape.origin && Number.isFinite(shape.origin.x) ) return { x: shape.origin.x, y: shape.origin.y };
      const points = shape.points ?? [];
      const n = points.length / 2;
      if ( !n ) return fallback;
      let x = 0, y = 0;
      for ( let i = 0; i < points.length; i += 2 ) { x += points[i]; y += points[i + 1]; }
      return { x: x / n, y: y / n };
    }
    default:
      return fallback;
  }
}

/* -------------------------------------------- */
/*  A true Sphere                               */
/* -------------------------------------------- */

/**
 * Distance from a point to an axis-aligned box (0 if the point is inside). Same units
 * throughout: the caller converts elevations into the unit of x, y.
 * @param {{x: number, y: number, z: number}} point
 * @param {{x0: number, x1: number, y0: number, y1: number, z0: number, z1: number}} box
 */
export function pointBoxDistance(point, box) {
  const dx = Math.max(box.x0 - point.x, 0, point.x - box.x1);
  const dy = Math.max(box.y0 - point.y, 0, point.y - box.y1);
  const dz = Math.max(box.z0 - point.z, 0, point.z - box.z1);
  return Math.hypot(dx, dy, dz);
}

/**
 * Is a creature (its box) inside a Sphere? A region's elevation slice turns a
 * Sphere into a cylinder: in the corners of the cylinder, outside the Sphere, a creature is spared (P2).
 * @param {{x: number, y: number, z: number, radius: number}} sphere
 * @param {object} box  See `pointBoxDistance`.
 */
export function withinSphere(sphere, box) {
  return pointBoxDistance(sphere, box) <= sphere.radius + 1e-6;
}

/**
 * Do two positions overlap vertically (feet to head)? A climber 10 ft above an occupied cell does not
 * occupy its space (§192: three-dimensional occupancy). Head against feet counts as contact.
 * @param {{elevation?: number, depth?: number}} a
 * @param {{elevation?: number, depth?: number}} b
 * @param {number} gridDistance
 */
export function overlapsVertically(a, b, gridDistance) {
  return verticalGap(verticalExtent(a, gridDistance), verticalExtent(b, gridDistance)) <= 1e-6;
}

/* -------------------------------------------- */
/*  Zones de plusieurs formes (§286)            */
/* -------------------------------------------- */

/**
 * The rectangle of a "rectangle" region shape, axis-aligned (anchor included), or null for any other shape.
 * @param {{type: string, x: number, y: number, width: number, height: number, anchorX?: number, anchorY?: number}} shape
 * @returns {{x0: number, y0: number, x1: number, y1: number}|null}
 */
export function rectOfShape(shape) {
  if ( (shape?.type !== "rectangle") || !Number.isFinite(shape.width) || !Number.isFinite(shape.height) ) return null;
  const x0 = shape.x - ((shape.anchorX ?? 0) * shape.width), y0 = shape.y - ((shape.anchorY ?? 0) * shape.height);
  return { x0, y0, x1: x0 + shape.width, y1: y0 + shape.height };
}

/** Is the point inside the rectangle (edges included)? */
export function pointInRect(point, rect) {
  return !!rect && (point.x >= rect.x0 - 1e-6) && (point.x <= rect.x1 + 1e-6) && (point.y >= rect.y0 - 1e-6) && (point.y <= rect.y1 + 1e-6);
}

/**
 * §286: "contiguous" Cubes (Fire Storm: "each cube must be contiguous to at least one other") — all linked step by step
 * by a shared face (an overlap counts, a lone corner does not). Fewer than two rectangles: contiguous.
 * @param {Array<{x0: number, y0: number, x1: number, y1: number}>} rects
 */
export function contiguousRects(rects) {
  if ( rects.length < 2 ) return true;
  const eps = 1e-6;
  const span = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  const touch = (a, b) => {
    const sx = span(a.x0, a.x1, b.x0, b.x1), sy = span(a.y0, a.y1, b.y0, b.y1);
    return ((sx > eps) && (sy > -eps)) || ((sy > eps) && (sx > -eps));
  };
  const seen = new Set([0]);
  const queue = [0];
  while ( queue.length ) {
    const i = queue.shift();
    rects.forEach((r, j) => { if ( !seen.has(j) && touch(rects[i], r) ) { seen.add(j); queue.push(j); } });
  }
  return seen.size === rects.length;
}

/**
 * §286: an area of several shapes (Meteor Swarm: four Spheres; Fire Storm: ten Cubes) takes a creature if ONE of
 * its shapes contains and reaches it — each shape has its own origin point. What the creature becomes for `areaTargets`:
 * `inVolume` (false: outside every shape), `lineOfEffect` (false: every shape that contains it is stopped by a floor).
 * @param {Array<{inShape: boolean|null, lineOfEffect: boolean|null}>} results  One row per shape; null: unknown.
 * @returns {{inVolume: boolean|null, lineOfEffect: boolean|null}}
 */
export function anyShapeTakes(results) {
  if ( !results?.length ) return { inVolume: null, lineOfEffect: null };
  const takes = results.find(r => (r.inShape !== false) && (r.lineOfEffect !== false));
  if ( takes ) return { inVolume: takes.inShape ?? null, lineOfEffect: takes.lineOfEffect ?? null };
  if ( results.some(r => r.inShape !== false) ) return { inVolume: null, lineOfEffect: false };
  return { inVolume: false, lineOfEffect: null };
}
