/**
 * §484 : l'eau courante (faiblesses du vampire, régénération arrêtée). Rien dans dnd5e ni dans le cœur ne dit qu'une case est de l'eau
 * courante : le MJ la marque.
 *  - une région de la scène : `flags["dnd5e-combat"].runningWater === true` (la rivière, le gué) ;
 *  - toute la scène : le même drapeau sur la scène (une barque sur le fleuve).
 * Le token y est quand le centre de ses pieds est dans la région (`RegionDocument#testPoint`, élévation comprise — même lecture que le
 * terrain difficile, adapter/jump.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { tokenCenter } from "./turn.mjs";

export const RUNNING_WATER_FLAG = "runningWater";

/** Les régions marquées « eau courante » d'une scène. */
export function runningWaterRegions(scene) {
  return (scene?.regions ?? []).filter(r => r.getFlag?.(MODULE_ID, RUNNING_WATER_FLAG) === true);
}

/**
 * Ce token est-il dans de l'eau courante ?
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
