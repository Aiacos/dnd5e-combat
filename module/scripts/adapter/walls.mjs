/**
 * §162: the core walls that a spell area places (content `walls: { move?, sight?, activities? }`) — along the axis of each
 * "line" shape (a wall placed by points), otherwise around the region's perimeter (globe, sphere, cube). They carry the
 * region that placed them (`flags.dnd5e-combat.zone`) and its levels. Wall of Force: stops movement, not sight; Prismatic
 * Wall: stops sight, not movement. Active GM. §225: `ethereal: true` (Wall of Force, Forcecage) — the wall also stops whoever
 * is on the Ethereal plane (`flags.dnd5e-combat.ethereal`, which the GM can also set by hand on a map wall).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { lineAxis, polygonEdges, circleEdges } from "../core/wall.mjs";
import { wallGeometryOf } from "./wall-side.mjs";

/** The `walls` rule that applies to this region (the activity that placed it), or null. */
export function wallRuleOf(region) {
  const uuid = region?.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  const rule = activity?.item ? contentOf(activity.item).entry?.walls : null;
  if ( !rule || (rule.activities && !rule.activities.includes(activity.id)) ) return null;
  return rule;
}

/** The wall data of a region. */
export function wallDataFor(region, rule) {
  const block = CONST.WALL_MOVEMENT_TYPES.NORMAL;
  const sense = CONST.EDGE_SENSE_TYPES.NORMAL;
  const none = CONST.EDGE_SENSE_TYPES.NONE;
  const lines = region.shapes.filter(s => s.type === "line");
  // §169, §172: a ring wall ("ring" shape: Wall of Fire, Wall of Thorns) — a single circle of walls, in the middle of the band.
  const ring = region.shapes.some(s => s.type === "ring") ? wallGeometryOf(region)?.ring : null;
  const segments = ring ? circleEdges(ring)
    : (lines.length === region.shapes.length) ? lines.map(s => lineAxis(s))
    : region.polygons.flatMap(p => polygonEdges(p.points));
  return segments.map(c => ({
    c,
    move: rule.move === false ? CONST.WALL_MOVEMENT_TYPES.NONE : block,
    sight: rule.sight ? sense : none,
    light: rule.sight ? sense : none,
    sound: none,
    levels: Array.from(region.levels ?? []),
    flags: { [MODULE_ID]: { zone: region.id, ...(rule.ethereal ? { ethereal: true } : {}) } }
  }));
}

/** The walls placed for this region. */
export function zoneWallsOf(region) {
  return (region.parent?.walls ?? []).filter(w => w.getFlag(MODULE_ID, "zone") === region.id);
}
