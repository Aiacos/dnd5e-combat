/**
 * §169: a wall with a burning face (Wall of Fire, content `wallSide: { distance, units }`). Placed along the grid lines (no
 * diagonal) or as a ring, it is thin: no cell is "inside" it. What applies on the grid:
 *  - on appearance, the creatures whose space TOUCHES the wall (on both sides) make the save (`readActivityRegion`);
 *  - then, with no save: whoever CROSSES the wall ("enters the wall", once per turn), and whoever ends their turn on the
 *    burning side, within `distance` of the wall — a second region, placed by the engine, that the caster can flip.
 * The wall carries its side (`flags.dnd5e-combat.wallSide`), the burning face its origin region (`flags.dnd5e-combat.sideOf`).
 * Read only: runtime/wall-side.mjs writes, runtime/areas.mjs replays.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { committedPosition, tokenCenter } from "./turn.mjs";
import { wallGeometry, touchesWall, crossesWall } from "../core/wall.mjs";
import { lengthIn } from "./units.mjs";

/** The `wallSide` rule of the spell that placed this region (the wall itself, not its burning face), or null. */
export function wallSideRuleOf(region) {
  if ( !region || region.getFlag?.(MODULE_ID, "sideOf") ) return null;
  const uuid = region.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return activity?.item ? (contentOf(activity.item).entry?.wallSide ?? null) : null;
}

/** The content entry of the spell that placed this region, or null. */
function entryOfRegion(region) {
  const uuid = region?.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return activity?.item ? (contentOf(activity.item).entry ?? null) : null;
}

/**
 * §169, §173: a thin wall (Wall of Fire, Wind Wall, Wall of Stone, Wall of Ice, Wall of Force, Prismatic Wall) — the wall itself,
 * not an area it placed: on appearance, the creatures whose space touches it; one "enters" it by crossing it.
 */
export function isThinWall(region) {
  if ( !region || region.getFlag?.(MODULE_ID, "sideOf") || region.getFlag?.(MODULE_ID, "auraOf") ) return false;
  const entry = entryOfRegion(region);
  return !!(entry?.wallSide || (entry?.thinWall === true));
}

/** §173: the `wallAura` area of the spell that placed this wall, or null. */
export function wallAuraRuleOf(region) {
  if ( !region || region.getFlag?.(MODULE_ID, "sideOf") || region.getFlag?.(MODULE_ID, "auraOf") ) return null;
  return entryOfRegion(region)?.wallAura ?? null;
}

/** The `wallAura` area placed for this wall, or null. */
export function auraRegionOf(wall) {
  return wall?.parent?.regions.find(r => r.getFlag(MODULE_ID, "auraOf") === wall.id) ?? null;
}

/** §172: is the spell that placed this region a thick wall placed on cells (`cellWall`)? */
export function isCellWall(region) {
  const uuid = region?.getFlag?.("dnd5e", "activity");
  const activity = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return activity?.item ? (contentOf(activity.item).entry?.cellWall === true) : false;
}

/** The wall's geometry (segments or ring), from its shapes. */
export function wallGeometryOf(region) {
  return wallGeometry((region?.shapes ?? []).map(s => s.toObject?.() ?? s));
}

/** The depth of the burning face, in scene pixels. */
export function sideDepthOf(scene, rule) {
  let distance = lengthIn(rule.distance, rule.units, scene.grid.units);
  return distance * (scene.grid.size / scene.grid.distance);
}

/** The rectangle of a token's space (validated position, or given), in pixels. */
function spaceOf(token, pos=committedPosition(token)) {
  const grid = token.parent.grid;
  return { x: pos.x, y: pos.y, width: (pos.width ?? 1) * grid.sizeX, height: (pos.height ?? 1) * grid.sizeY };
}

/** The center of a token at a given position (waypoint), in pixels, in 2D. */
function centerAt(token, pos) {
  const { x, y } = tokenCenter(token, pos);
  return { x, y };
}

/** Does this token's space touch the wall? ("in the area" on appearance.) */
export function touchesWallRegion(region, token) {
  const geometry = wallGeometryOf(region);
  return !!geometry && touchesWall(geometry, spaceOf(token));
}

/** Does this path (successive token positions) cross the wall? */
export function crossesWallRegion(region, token, positions) {
  const geometry = wallGeometryOf(region);
  return !!geometry && crossesWall(geometry, positions.map(p => centerAt(token, p)));
}

/** The burning face of this wall, or null. */
export function sideRegionOf(wall) {
  return wall?.parent?.regions.find(r => r.getFlag(MODULE_ID, "sideOf") === wall.id) ?? null;
}

/** The scene's burning-face walls placed by this caster (its actor). */
export function wallsOfCaster(token) {
  const actor = token?.actor;
  if ( !actor ) return [];
  return (token.parent?.regions ?? []).filter(r => {
    if ( !wallSideRuleOf(r) || !r.getFlag(MODULE_ID, "wallSide") ) return false;
    const item = fromUuidSync(r.getFlag("dnd5e", "item") ?? "", { strict: false });
    return item?.actor === actor;
  });
}
