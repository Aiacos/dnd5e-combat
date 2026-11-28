/**
 * Three-dimensional space in play (SPEC §14.2, P2): the world setting "Elevation and
 * volumes", the core API self-check at `ready`, and the elevation slice given to
 * spell areas **when placed**, in the creation data that dnd5e submits to the hook
 * `dnd5e.createMeasuredTemplate` (canvas/template-placement.mjs:172) — on the client that places the
 * template, player included: the region is born with its height, nobody has to rewrite it.
 *
 * 3D distances (adapter/turn.mjs) depend on no setting: without elevation, nothing
 * changes. This setting holds the slice of the areas and the line of effect through surfaces.
 */

import { MODULE_ID } from "../constants.mjs";
import { checkSpaceApi, setSpaceAvailable, isSpaceAvailable, elevationSliceFor } from "../adapter/space.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const VOLUMES_SETTING = "volumes";

function refresh() {
  setSpaceAvailable(game.settings.get(MODULE_ID, VOLUMES_SETTING) && !checkSpaceApi().length);
}

/** dnd5e is about to create the regions of an activity: we give them their elevation slice. */
function onTemplateData(activity, regionData) {
  if ( !isSpaceAvailable() || !canvas?.scene ) return;
  const originToken = usageTokenOf(activity);
  for ( const data of regionData ) {
    if ( data.elevation && ((data.elevation.bottom ?? null) !== null || (data.elevation.top ?? null) !== null) ) continue;
    const slice = elevationSliceFor(activity, { scene: canvas.scene, originToken, dimensions: data.flags?.dnd5e?.dimensions ?? null });
    if ( !slice ) continue;
    data.elevation = slice;
    log(`area of ${activity.item?.name ?? activity.name}: elevation slice ${slice.bottom} -> ${slice.top} ${canvas.scene.grid.units}`);
  }
}

export function registerSpace() {
  game.settings.register(MODULE_ID, VOLUMES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${VOLUMES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${VOLUMES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh
  });

  route("dnd5e.createMeasuredTemplate", onTemplateData, { label: "area: elevation slice not set" });

  // Core 14.368 trap (seen in play on 2026-09-23): `RegionDocument#segmentizeMovementPath` reads the
  // private field `#polygonTree` (client/documents/region.mjs, #testSamples) without going through the accessor that
  // builds it; a PURE elevation change of a token (without x/y) then crashes with "Cannot read properties
  // of undefined (reading 'testPoint')" as long as nothing has read `region.polygonTree`. We read it for every
  // region of the displayed scene — it is a cache, not a patch.
  const warm = () => { for ( const r of canvas?.scene?.regions ?? [] ) r.polygonTree; };
  for ( const hook of ["canvasReady", "createRegion", "updateRegion"] ) route(hook, warm, { label: "regions: polygons not prepared" });

  route("ready", () => {
    const missing = checkSpaceApi();
    if ( missing.length ) {
      console.warn(`${MODULE_ID} | elevation and volumes out of service: core API missing (${missing.join(", ")})`);
      if ( game.user.isGM ) ui.notifications.warn(game.i18n.format("DND5ECOMBAT.VolumesHorsService", { missing: missing.join(", ") }));
    }
    refresh();
    log(`elevation and volumes: ${game.settings.get(MODULE_ID, VOLUMES_SETTING) ? (missing.length ? "out of service" : "in service") : "disabled (setting)"}`);
  }, { label: "space: API check" });
}
