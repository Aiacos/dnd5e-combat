/**
 * §182: vision cones outside combat. A GM creature, outside a started combat, only sees in a cone centered on
 * its rotation (core convention: 0 = down, clockwise); the angle depends on its creature type (configurable), on a
 * token flag, or on the token's `sight.angle` if narrower. Blindsight, Tremorsense and Truesight
 * perceive in 360° within their range. In combat: 360°, like the 2024 rules.
 * Pure functions.
 */

/** Default angles: most creatures see ahead of them; oozes and plants, having no eyes, see everywhere. */
export const DEFAULT_CONE_ANGLES = Object.freeze({ default: 120, beast: 150, ooze: 360, plant: 360 });

/** The text of the default setting (`120; beast 150; ooze 360; plant 360`). */
export function formatConeAngles(table=DEFAULT_CONE_ANGLES) {
  const { default: base, ...types } = table;
  return [String(base ?? 120), ...Object.entries(types).map(([k, v]) => `${k} ${v}`)].join("; ");
}

const clampAngle = v => Math.min(360, Math.max(1, Math.round(v)));

/**
 * Read the setting: a lone number = the default angle; `type nombre` = the angle of a type (or subtype, or identifier).
 * What cannot be read is ignored.
 * @param {string} text
 * @returns {Object<string, number>}
 */
export function parseConeAngles(text) {
  const out = { default: DEFAULT_CONE_ANGLES.default };
  for ( const part of String(text ?? "").split(/[;\n]+/) ) {
    const bits = part.trim().split(/[\s:=]+/).filter(Boolean);
    if ( bits.length === 1 && Number.isFinite(Number(bits[0])) ) out.default = clampAngle(Number(bits[0]));
    else if ( (bits.length === 2) && Number.isFinite(Number(bits[1])) ) out[bits[0].toLowerCase()] = clampAngle(Number(bits[1]));
  }
  return out;
}

/** The angle of a creature: identifier > subtype > type > default. */
export function coneAngleFor(table, { type, subtype, identifier }={}) {
  const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");
  if ( identifier && (low(identifier) in table) ) return table[low(identifier)];
  for ( const s of low(subtype).split(/[,;/]+/).map(x => x.trim()).filter(Boolean) ) if ( s in table ) return table[s];
  if ( type && (low(type) in table) ) return table[low(type)];
  return table.default ?? DEFAULT_CONE_ANGLES.default;
}

/** The heading of a vector in the core convention (0 = down, 90 = left, clockwise), in degrees [0, 360). */
export function bearingOf(dx, dy) {
  const deg = Math.atan2(-dx, dy) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** The signed difference between two headings, in (-180, 180]. */
export function angleBetween(a, b) {
  let d = ((b - a) % 360 + 360) % 360;
  if ( d > 180 ) d -= 360;
  return d;
}

/**
 * Is one of the points in the cone? A point coinciding with the eye counts as inside.
 * @param {{x: number, y: number}} eye
 * @param {number} rotation  degrees, core convention
 * @param {number} angle     total opening, degrees; ≥ 360: everywhere
 * @param {Array<{x: number, y: number}>} points
 */
export function inCone(eye, rotation, angle, points) {
  if ( !(angle < 360) ) return true;
  const half = angle / 2;
  return points.some(p => {
    const dx = p.x - eye.x, dy = p.y - eye.y;
    if ( Math.hypot(dx, dy) < 1e-6 ) return true;
    return Math.abs(angleBetween(rotation ?? 0, bearingOf(dx, dy))) <= half + 1e-6;
  });
}
