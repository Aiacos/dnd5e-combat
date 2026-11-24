/**
 * §530 (Gabe's request, 2026-11-24): who sees the areas placed from an activity. dnd5e places them visible to everyone
 * (`REGION_VISIBILITY.ALWAYS`), and the engine places its own the same way (adapter/self-area.mjs). The world setting `areaVisibility`
 * can only make an area LESS visible, never more: an area already hidden (a storm cloud, an area shown on the Region layer) stays so.
 */

/** The setting's choices, from the most to the least visible. */
export const AREA_VISIBILITY_CHOICES = Object.freeze(["all", "gm", "layer"]);

/**
 * The visibility an area should be created with.
 * @param {number} current         The visibility it was about to get (`REGION_VISIBILITY` value).
 * @param {string} choice          The setting (`all`, `gm`, `layer`).
 * @param {object} levels          `REGION_VISIBILITY` (LAYER, LAYER_UNLOCKED, GAMEMASTER, OBSERVER, ALWAYS).
 * @returns {number}
 */
export function areaVisibilityFor(current, choice, levels) {
  const rank = v => {
    if ( (v === levels.LAYER) || (v === levels.LAYER_UNLOCKED) ) return 0;
    if ( v === levels.GAMEMASTER ) return 1;
    if ( v === levels.OBSERVER ) return 2;
    return 3;   // ALWAYS, or unknown: treated as the most visible
  };
  const wanted = { gm: levels.GAMEMASTER, layer: levels.LAYER }[choice];
  if ( wanted === undefined ) return current;
  return (rank(wanted) < rank(current)) ? wanted : current;
}
