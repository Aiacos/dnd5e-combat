/**
 * §484: running water (the vampire's weaknesses, regeneration stopped). Nothing in dnd5e or the core says a cell is running
 * water: the GM marks it.
 *  - a region of the scene: `flags["dnd5e-combat"].runningWater === true` (the river, the ford);
 *  - the whole scene: the same flag on the scene (a boat on the river).
 * The token is in it when the center of its feet is in the region (`RegionDocument#testPoint`, elevation included — same reading as
 * Difficult Terrain, adapter/jump.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { tokenCenter } from "./turn.mjs";

export const RUNNING_WATER_FLAG = "runningWater";

/** A scene's regions marked "running water". */
export function runningWaterRegions(scene) {
  return (scene?.regions ?? []).filter(r => r.getFlag?.(MODULE_ID, RUNNING_WATER_FLAG) === true);
}

/**
 * Is this token in running water?
 * @param {TokenDocument|null} doc
 * @returns {boolean}
 */
export function inRunningWater(doc) {
  const scene = doc?.parent;
  if ( !scene ) return false;
  if ( scene.getFlag?.(MODULE_ID, RUNNING_WATER_FLAG) === true ) return true;
  const regions = runningWaterRegions(scene);
  if ( !regions.length ) return false;
  const p = tokenCenter(doc);
  const point = { x: p.x, y: p.y, elevation: p.elevation ?? doc.elevation ?? 0 };
  return regions.some(r => r.testPoint?.(point) === true);
}
