/**
 * §162: a wall placed by points (Wall of Fire, Wall of Force in panels, Blade Barrier…). The player picks two or more points; the
 * wall follows the broken line, at most its total length. Each segment becomes a "line" shape of the region (origin, angle,
 * length, thickness — like an aimed line, adapter/self-area.mjs), and the engine places, along each one, the core walls the spell
 * requires (`walls` of the content). Pure geometry, in pixels; no dependency on Foundry.
 */

/** Length of a broken line. */
export function polylineLength(points) {
  let total = 0;
  for ( let i = 1; i < points.length; i++ ) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

/**
 * The broken line brought down to `max` long: points beyond are removed, the last segment shortened. Coincident points are
 * discarded.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} max   Maximum length (Infinity: no limit).
 * @returns {Array<{x: number, y: number}>}
 */
export function clampPolyline(points, max=Infinity) {
  const out = [];
  let left = max;
  for ( const p of points ) {
    if ( !out.length ) { out.push({ x: p.x, y: p.y }); continue; }
    const a = out.at(-1);
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if ( d < 1e-6 ) continue;
    if ( d <= left + 1e-6 ) { out.push({ x: p.x, y: p.y }); left -= d; continue; }
    if ( left > 1e-6 ) out.push({ x: a.x + ((p.x - a.x) * left) / d, y: a.y + ((p.y - a.y) * left) / d });
    break;
  }
  return out;
}

/**
 * The "line" shapes of a broken line: one per segment, of the given thickness.
 * @param {Array<{x: number, y: number}>} points
 * @param {number} width   Thickness, in pixels.
 * @returns {Array<{type: "line", x: number, y: number, rotation: number, length: number, width: number}>}
 */
export function wallLineShapes(points, width) {
  const shapes = [];
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if ( length < 1e-6 ) continue;
    shapes.push({ type: "line", x: a.x, y: a.y, rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, length, width });
  }
  return shapes;
}

/** The axis of a "line" shape: its two endpoints, rounded to the pixel (the core walls have integer coordinates). */
export function lineAxis({ x, y, rotation, length }) {
  const r = (rotation * Math.PI) / 180;
  return [Math.round(x), Math.round(y), Math.round(x + (Math.cos(r) * length)), Math.round(y + (Math.sin(r) * length))];
}

/** The edges of a closed polygon (`[x0, y0, x1, y1, …]`), as rounded `[x1, y1, x2, y2]` segments. */
export function polygonEdges(flat) {
  const n = Math.floor(flat.length / 2);
  const edges = [];
  for ( let i = 0; i < n; i++ ) {
    const j = (i + 1) % n;
    const edge = [flat[2 * i], flat[(2 * i) + 1], flat[2 * j], flat[(2 * j) + 1]].map(Math.round);
    if ( (edge[0] !== edge[2]) || (edge[1] !== edge[3]) ) edges.push(edge);
  }
  return edges;
}

/* -------------------------------------------- */
/*  Burning-face wall (§169)                    */
/* -------------------------------------------- */

/**
 * §169: each point aligned with the previous one, on the axis where it departs the most — a wall with no diagonal, along the grid
 * lines (a diagonal cut cells at an angle: only a few were "inside").
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<{x: number, y: number}>}
 */
export function orthogonalize(points) {
  const out = [];
  for ( const p of points ) {
    const a = out.at(-1);
    if ( !a ) out.push({ x: p.x, y: p.y });
    else out.push(Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y });
  }
  return out;
}

/**
 * The side of a segment on which a point lies: +1 to the left of the drawing direction (on screen, the y axis pointing down: the
 * normal `(dy, -dx)`), -1 to the right, 0 on its line.
 */
export function sideOfSegment([x1, y1, x2, y2], { x, y }) {
  const d = ((y2 - y1) * (x - x1)) - ((x2 - x1) * (y - y1));
  return Math.abs(d) < 1e-9 ? 0 : Math.sign(d);
}

/** Distance from a point to a segment. */
function distanceToSegment([x1, y1, x2, y2], { x, y }) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = (dx * dx) + (dy * dy);
  const t = len2 ? Math.max(0, Math.min(1, (((x - x1) * dx) + ((y - y1) * dy)) / len2)) : 0;
  return Math.hypot(x - (x1 + (t * dx)), y - (y1 + (t * dy)));
}

/**
 * The geometry of a burning-face wall, taken from the shapes of its region: segments ("line" shapes), or a ring — the "ring" shape
 * of the V14 core (dnd5e "ring" template, or the thin ring that the disc of a "cylinder" template becomes), or that disc itself (a
 * circle, or a round ellipse placed by coordinates).
 * @param {object[]} shapes   The shapes of the region (data).
 * @returns {{lines: number[][]}|{ring: {x: number, y: number, radius: number}}|null}
 */
export function wallGeometry(shapes, axisOf=lineAxis) {
  const list = shapes ?? [];
  const lines = list.filter(s => s.type === "line");
  if ( lines.length ) return { lines: lines.map(s => axisOf(s)) };
  const ring = list.find(s => (s.type === "ring") && Number.isFinite(s.radius));
  // The middle of the band: from `radius - innerWidth` to `radius + outerWidth`.
  if ( ring ) return { ring: { x: ring.x, y: ring.y, radius: ring.radius + (((ring.outerWidth ?? 0) - (ring.innerWidth ?? 0)) / 2) } };
  const disc = list.map(s => ((s.type === "ellipse") && (s.radiusX === s.radiusY)) ? { ...s, type: "circle", radius: s.radiusX } : s)
    .find(s => (s.type === "circle") && Number.isFinite(s.radius) && !s.hole);
  return disc ? { ring: { x: disc.x, y: disc.y, radius: disc.radius } } : null;
}

/**
 * The default burning side: the one where the caster is not — for a line, the other side of the segment nearest to it; for
 * a ring, the outside if the caster is inside, the inside otherwise. +1: left of the drawing, or the inside of the ring;
 * -1: the opposite.
 */
export function defaultSide(geometry, caster) {
  if ( !geometry || !caster ) return 1;
  if ( geometry.ring ) return Math.hypot(caster.x - geometry.ring.x, caster.y - geometry.ring.y) < geometry.ring.radius ? -1 : 1;
  const nearest = geometry.lines.reduce((best, l) => (distanceToSegment(l, caster) < distanceToSegment(best, caster) ? l : best));
  return -(sideOfSegment(nearest, caster) || -1);
}

/**
 * The shapes of the burning face: `depth` pixels along each segment, on the chosen side (one polygon per segment); for a
 * ring, the inner disc (+1) or the crown of `depth` around it (-1, "ring" shape).
 * @param {{lines: number[][]}|{ring: object}} geometry
 * @param {1|-1} side
 * @param {number} depth
 */
export function sideShapes(geometry, side, depth) {
  if ( geometry?.ring ) {
    const { x, y, radius } = geometry.ring;
    return side > 0 ? [{ type: "circle", x, y, radius }] : [{ type: "ring", x, y, radius, innerWidth: 0, outerWidth: depth }];
  }
  const lines = geometry?.lines ?? [];
  const normal = ([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    return { x: (side * (y2 - y1) * depth) / len, y: (side * -(x2 - x1) * depth) / len };
  };
  const shapes = lines.map(l => {
    const [x1, y1, x2, y2] = l;
    const n = normal(l);
    return { type: "polygon", points: [x1, y1, x2, y2, x2 + n.x, y2 + n.y, x1 + n.x, y1 + n.y].map(v => Math.round(v)) };
  });
  // At the corners of the drawing, the square that joins the two bands (it was missing at the outer corner;
  // inside, it falls within the bands).
  for ( let i = 1; i < lines.length; i++ ) {
    const [, , px, py] = lines[i - 1];
    const [qx, qy] = lines[i];
    if ( Math.hypot(px - qx, py - qy) > 1 ) continue;
    const a = normal(lines[i - 1]), b = normal(lines[i]);
    shapes.push({ type: "polygon", points: [px, py, px + a.x, py + a.y, px + a.x + b.x, py + a.y + b.y, px + b.x, py + b.y].map(v => Math.round(v)) });
  }
  return shapes;
}

/** The thin ring of a circular wall: the core "ring" shape, of thickness `width`, centred on the radius. */
export function ringShapes({ x, y, radius }, width) {
  const half = Math.max(1, width / 2);
  return [{ type: "ring", x, y, radius, innerWidth: Math.min(half, radius), outerWidth: half }];
}

/** Do the two segments cross cleanly (not at an end, not aligned)? */
function segmentsCross([ax, ay, bx, by], [cx, cy, dx, dy]) {
  const o = (px, py, qx, qy, rx, ry) => Math.sign(((qx - px) * (ry - py)) - ((qy - py) * (rx - px)));
  return (o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0) && (o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0);
}

/**
 * Does a path (successive centres) cross the wall? A line: a step that cuts a segment; a ring: a step that goes from one side of
 * the circle to the other.
 * @param {{lines: number[][]}|{ring: object}} geometry
 * @param {Array<{x: number, y: number}>} path
 */
export function crossesWall(geometry, path) {
  for ( let i = 1; i < (path?.length ?? 0); i++ ) {
    const a = path[i - 1], b = path[i];
    if ( geometry?.ring ) {
      const { x, y, radius } = geometry.ring;
      const da = Math.hypot(a.x - x, a.y - y) - radius, db = Math.hypot(b.x - x, b.y - y) - radius;
      if ( da * db < 0 ) return true;
    }
    else if ( (geometry?.lines ?? []).some(l => segmentsCross([a.x, a.y, b.x, b.y], l)) ) return true;
  }
  return false;
}

/**
 * Does a creature's space (rectangle in pixels) touch the wall? A segment: it runs along or crosses the rectangle over a length
 * (a lone corner does not count); a ring: the circle passes through the rectangle. This is "in the area" when the wall appears, on
 * both sides: on the grid, a 1 ft wall placed between cells covers no cell.
 * @param {{lines: number[][]}|{ring: object}} geometry
 * @param {{x: number, y: number, width: number, height: number}} rect
 */
export function touchesWall(geometry, { x, y, width, height }) {
  const eps = 1e-6;
  if ( geometry?.ring ) {
    const { x: cx, y: cy, radius } = geometry.ring;
    const near = Math.hypot(Math.max(x - cx, 0, cx - (x + width)), Math.max(y - cy, 0, cy - (y + height)));
    const far = Math.max(...[[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([px, py]) => Math.hypot(px - cx, py - cy)));
    return (near < radius) && (far > radius);
  }
  return (geometry?.lines ?? []).some(([x1, y1, x2, y2]) => {
    // Liang–Barsky: the part of the segment inside the closed rectangle.
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    for ( const [p, q] of [[-dx, x1 - x], [dx, (x + width) - x1], [-dy, y1 - y], [dy, (y + height) - y1]] ) {
      if ( Math.abs(p) < eps ) { if ( q < -eps ) return false; continue; }
      const r = q / p;
      if ( p < 0 ) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if ( t0 > t1 ) return false;
    }
    return (t1 - t0) * Math.hypot(dx, dy) > 0.5;
  });
}

/** The edges of a circle approximated by `n` sides (the core walls of a ring wall). */
export function circleEdges({ x, y, radius }, n=24) {
  const pts = Array.from({ length: n }, (_, i) => [x + (radius * Math.cos((2 * Math.PI * i) / n)), y + (radius * Math.sin((2 * Math.PI * i) / n))]);
  return pts.map((p, i) => [...p, ...pts[(i + 1) % n]].map(Math.round));
}

/**
 * §170: where to place a wall's lights — one point every `step` pixels along each segment (ends included), or along the circle,
 * offset by `offset` on each side: the wall stops light, a source placed on its line would light neither side.
 * @param {{lines: number[][]}|{ring: {x: number, y: number, radius: number}}} geometry
 * @returns {Array<{x: number, y: number}>}
 */
export function wallLightPoints(geometry, step, offset) {
  const out = [];
  if ( geometry?.ring ) {
    const { x, y, radius } = geometry.ring;
    const n = Math.max(6, Math.ceil((2 * Math.PI * radius) / step));
    for ( let i = 0; i < n; i++ ) {
      const a = (2 * Math.PI * i) / n;
      for ( const r of [radius - offset, radius + offset] ) out.push({ x: Math.round(x + (r * Math.cos(a))), y: Math.round(y + (r * Math.sin(a))) });
    }
    return out;
  }
  for ( const [x1, y1, x2, y2] of geometry?.lines ?? [] ) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if ( len < 1e-6 ) continue;
    const n = Math.max(1, Math.round(len / step));
    const nx = ((y2 - y1) / len) * offset, ny = (-(x2 - x1) / len) * offset;
    for ( let i = 0; i <= n; i++ ) {
      const px = x1 + (((x2 - x1) * i) / n), py = y1 + (((y2 - y1) * i) / n);
      for ( const s of [1, -1] ) out.push({ x: Math.round(px + (s * nx)), y: Math.round(py + (s * ny)) });
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Thick wall placed on cells (§172)           */
/* -------------------------------------------- */

/**
 * §172: a wall one cell thick (Wall of Thorns, Blade Barrier) is placed on a row of cells — the points at the centre of the
 * cells, no diagonal; each segment is extended by half a cell at both ends, to cover the first and last cell
 * fully (at the corners, two segments overlap). The line of centres is first bounded to `length - 2 × half`: the wall, ends
 * included, keeps the length of the spell.
 * @param {Array<{x: number, y: number}>} points   Cell centres.
 * @param {number} length   Spell length, in pixels.
 * @param {number} width    Thickness, in pixels.
 * @param {number} half     One half cell, in pixels.
 */
export function cellWallShapes(points, length, width, half) {
  const line = clampPolyline(orthogonalize(points), Number.isFinite(length) ? Math.max(0, length - (2 * half)) : Infinity);
  if ( line.length === 1 ) return [{ type: "line", x: line[0].x - half, y: line[0].y, rotation: 0, length: 2 * half, width }];
  return wallLineShapes(line, width).map(s => {
    const r = (s.rotation * Math.PI) / 180;
    return { ...s, x: s.x - (Math.cos(r) * half), y: s.y - (Math.sin(r) * half), length: s.length + (2 * half) };
  });
}

/** The ring of a thick wall taken from the disc of its template: a band of `width` inside the circle (its diameter is the spell's). */
export function innerRingShapes({ x, y, radius }, width) {
  return [{ type: "ring", x, y, radius, innerWidth: Math.min(width, radius), outerWidth: 0 }];
}

/**
 * §173: the area at `distance` from a thin wall, on both sides (Prismatic Wall: the blinding at 6 m) — a rectangle around each
 * segment, extended by `distance` at its ends; for a ring, a band of `distance` on either side of the circle.
 */
export function auraShapes(geometry, distance) {
  if ( geometry?.ring ) {
    const { x, y, radius } = geometry.ring;
    return [{ type: "ring", x, y, radius, innerWidth: Math.min(distance, radius), outerWidth: distance }];
  }
  return (geometry?.lines ?? []).map(([x1, y1, x2, y2]) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = ((x2 - x1) / len) * distance, uy = ((y2 - y1) / len) * distance;
    const nx = -uy, ny = ux;
    const a = { x: x1 - ux, y: y1 - uy }, b = { x: x2 + ux, y: y2 + uy };
    return { type: "polygon", points: [a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny].map(v => Math.round(v)) };
  });
}
