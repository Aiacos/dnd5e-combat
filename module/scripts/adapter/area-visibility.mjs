/**
 * §530: the world setting `areaVisibility` — who sees the areas placed from an activity (dnd5e's placement and the engine's own).
 * Applied while the region is being created (`preCreateRegion`, on the client that creates it), so nothing is written twice.
 */

import { MODULE_ID } from "../constants.mjs";
import { AREA_VISIBILITY_CHOICES, areaVisibilityFor } from "../core/area-visibility.mjs";

export const AREA_VISIBILITY_SETTING = "areaVisibility";

export function registerAreaVisibilitySetting() {
  game.settings.register(MODULE_ID, AREA_VISIBILITY_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AREA_VISIBILITY_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AREA_VISIBILITY_SETTING}.Aide`,
    scope: "world", config: true, type: String, default: "all",
    choices: Object.fromEntries(AREA_VISIBILITY_CHOICES.map(c => [c, `DND5ECOMBAT.Reglage.${AREA_VISIBILITY_SETTING}.${c}`]))
  });
}

function areaVisibilityChoice() {
  try {
    const c = game.settings.get(MODULE_ID, AREA_VISIBILITY_SETTING);
    return AREA_VISIBILITY_CHOICES.includes(c) ? c : "all";
  }
  catch { return "all"; }
}

/**
 * A region placed from an activity (`flags.dnd5e.activity`, written by dnd5e's placement and by the engine) gets the visibility the
 * setting asks for. Any other region (drawn by hand, another module's) is left alone.
 * @param {RegionDocument} region   The document being created.
 * @param {object} data             Its creation data.
 * @returns {boolean}               Whether the visibility was changed.
 */
export function applyAreaVisibility(region, data) {
  if ( !foundry.utils.getProperty(data ?? {}, "flags.dnd5e.activity") && !region?.flags?.dnd5e?.activity ) return false;
  const current = region.visibility ?? data?.visibility ?? CONST.REGION_VISIBILITY.ALWAYS;
  const next = areaVisibilityFor(current, areaVisibilityChoice(), CONST.REGION_VISIBILITY);
  if ( next === current ) return false;
  region.updateSource({ visibility: next });
  return true;
}
