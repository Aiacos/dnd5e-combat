/**
 * A "self" area is placed on the caster automatically (SPEC §47). dnd5e 6 asks to place every area of an activity whose
 * `target.prompt` is true — even an Emanation with "self" range, where you must click your own token (Whirling
 * Blades, Spirit Guardians, Frightful Presence, Life Preservation…). There is nothing to choose: the
 * area starts from the caster. Here, the decision, without Foundry.
 *
 * Cones, Lines and Cubes with self range are aimed around the caster (§59, `aimedAreaShape`). Left to place
 * by hand: cylinders and walls (a place to choose — Wall of Fire), several areas at once, and any area of another
 * range.
 */

/** dnd5e area types (`CONFIG.DND5E.areaTargetTypes`) centered on the caster when the range is "self". */
const SELF_TYPES = Object.freeze({ radius: "emanation", sphere: "circle", circle: "circle" });

/**
 * @param {object} query
 * @param {string} [query.rangeUnits]  `activity.range.units`.
 * @param {string} [query.type]        `activity.target.template.type` (radius, sphere, cone…).
 * @param {number|string} [query.count] `activity.target.template.count` (empty: one area).
 * @param {number} [query.size]        Size of the area (radius), in the activity's unit.
 * @returns {"emanation"|"circle"|null}  The region shape to place on the caster, or null: dnd5e placement.
 */
export function selfAreaShape({ rangeUnits, type, count, size }={}) {
  if ( rangeUnits !== "self" ) return null;
  const shape = SELF_TYPES[type] ?? null;
  if ( !shape ) return null;
  if ( (Number(count) || 1) !== 1 ) return null;
  if ( !(Number(size) > 0) ) return null;
  return shape;
}

/**
 * §462: the area of a "departing" teleportation (`teleport.area: "left"` — "each creature within 10 feet of the space it left":
 * the Lich's Deadly Teleport) is placed automatically as a fixed Emanation around the space left, whatever the range of
 * the activity (that of the teleportation). A radius, a Sphere or a circle, a single area, of known size.
 * @param {{type?: string, count?: number|string, size?: number|string}} [query]
 * @returns {"emanation"|null}
 */
export function departureAreaShape({ type, count, size }={}) {
  if ( !SELF_TYPES[type] ) return null;
  if ( (Number(count) || 1) !== 1 ) return null;
  return (Number(size) > 0) ? "emanation" : null;
}

/* -------------------------------------------- */
/*  Cones and Lines starting from the caster (§59) */
/* -------------------------------------------- */

/** dnd5e area types that start from the caster in a direction to choose (breaths, Burning Hands, Lightning Bolt, Thunderwave). */
const AIMED_TYPES = Object.freeze({ cone: "cone", line: "line", cube: "cube" });

/**
 * A Cone or Line with "self" range is aimed around the caster (SPEC §59): its apex stays stuck to them, the
 * mouse only chooses the direction. Same conditions as the self area: a single area, of known size.
 * @param {object} query  Like `selfAreaShape`.
 * @returns {"cone"|"line"|"cube"|null}  The shape to aim, or null: dnd5e placement.
 */
export function aimedAreaShape({ rangeUnits, type, count, size }={}) {
  if ( rangeUnits !== "self" ) return null;
  const shape = AIMED_TYPES[type] ?? null;
  if ( !shape ) return null;
  if ( (Number(count) || 1) !== 1 ) return null;
  if ( !(Number(size) > 0) ) return null;
  return shape;
}

/**
 * The apex and direction of an area aimed from the caster. The area pivots around the caster's **center**, toward the
 * aimed point; its apex is placed on the **edge** of their space in that direction — not at the center, otherwise the area
 * would start under them (their own cell would be part of it). Edge of a rectangle (square token), or of an ellipse (elliptical
 * token of hex grids).
 * @param {{x: number, y: number, width: number, height: number}} body  The caster's space, in pixels (top-left corner).
 * @param {{x: number, y: number}} point     Aimed point (the mouse), in pixels.
 * @param {object} [options]
 * @param {boolean} [options.ellipse=false]  Elliptical space.
 * @param {{x: number, y: number}|null} [options.fallback=null]  Direction if the point is at the center (last aim).
 * @returns {{x: number, y: number, rotation: number}}  Apex (pixels) and direction in degrees, 0 = toward the right,
 *   clockwise (y downward), in [0, 360).
 */
export function aimFrom(body, point, { ellipse=false, fallback=null }={}) {
  const cx = body.x + (body.width / 2);
  const cy = body.y + (body.height / 2);
  let dx = point.x - cx;
  let dy = point.y - cy;
  if ( (Math.hypot(dx, dy) < 1e-6) ) ({ x: dx, y: dy } = fallback ?? { x: 1, y: 0 });
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const a = body.width / 2;
  const b = body.height / 2;
  let t;
  if ( ellipse ) t = 1 / Math.sqrt(((cos / a) ** 2) + ((sin / b) ** 2));
  else t = Math.min(Math.abs(cos) > 1e-9 ? a / Math.abs(cos) : Infinity, Math.abs(sin) > 1e-9 ? b / Math.abs(sin) : Infinity);
  const rotation = (((angle * 180) / Math.PI) + 360) % 360;
  return { x: cx + (t * cos), y: cy + (t * sin), rotation };
}

/**
 * A Cube with self range (Thunderwave: "a 15-foot Cube originating from you"): its point of origin is on a
 * face of the Cube, at the caster's edge. The Cube is therefore **adjoined** to the caster's space, on the mouse's side (the
 * dominant axis chooses the side), and slides along that side to follow the mouse, up to the corner positions where it only
 * touches them by a vertex — never on top of the caster. Aligned to the grid, no rotation; snapped by steps of `step` pixels
 * (one cell) from the caster's corner.
 * @param {{x: number, y: number, width: number, height: number}} body  The caster's space, in pixels (top-left corner).
 * @param {{x: number, y: number}} point  Aimed point (the mouse), in pixels.
 * @param {number} side                   Side of the Cube, in pixels.
 * @param {object} [options]
 * @param {number} [options.step=0]       Grid step (0: no grid, free position).
 * @param {{x: number, y: number}|null} [options.fallback=null]  Direction if the point is at the center.
 * @returns {{x: number, y: number}}  Top-left corner of the Cube.
 */
export function cubeBeside(body, point, side, { step=0, fallback=null }={}) {
  const cx = body.x + (body.width / 2);
  const cy = body.y + (body.height / 2);
  let dx = point.x - cx;
  let dy = point.y - cy;
  if ( (Math.hypot(dx, dy) < 1e-6) ) ({ x: dx, y: dy } = fallback ?? { x: 1, y: 0 });
  const slide = (want, start, length) => {
    let v = Math.min(Math.max(want, start - side), start + length);
    if ( step > 0 ) v = Math.min(Math.max(start + (Math.round((v - start) / step) * step), start - side), start + length);
    return v;
  };
  // On a tie (perfect diagonal), the horizontal side: the Cube then touches the caster by the corner.
  if ( Math.abs(dx) >= Math.abs(dy) ) {
    return { x: dx >= 0 ? body.x + body.width : body.x - side, y: slide(point.y - (side / 2), body.y, body.height) };
  }
  return { x: slide(point.x - (side / 2), body.x, body.width), y: dy >= 0 ? body.y + body.height : body.y - side };
}
