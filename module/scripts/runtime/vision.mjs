/**
 * Simulated vision and cover in operation (SPEC §14.1, P1): the world settings that
 * enable them, the core API's self-check at `ready`, and discarding the memoized vision sources
 * when the environment changes. The computations are in adapter/vision.mjs (consumed by
 * adapter/conditions.mjs, on the attacker's client) and adapter/cover.mjs (consumed by
 * runtime/engine.mjs, on the active GM, at the verdict).
 */

import { MODULE_ID } from "../constants.mjs";
import { checkVisionApi, invalidateVision, disposeVision, setVisionAvailable } from "../adapter/vision.mjs";
import { forgetSenses } from "../adapter/senses.mjs";
import { checkCoverApi, setCoverAvailable } from "../adapter/cover.mjs";
import { CONES_SETTING, ANGLES_SETTING, DEFAULT_ANGLES_TEXT } from "../adapter/cone.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const VISION_SETTING = "vision";
export const COVER_SETTING = "cover";

function refresh() {
  setVisionAvailable(game.settings.get(MODULE_ID, VISION_SETTING) && !checkVisionApi().length);
  setCoverAvailable(game.settings.get(MODULE_ID, COVER_SETTING) && !checkCoverApi().length);
}

export function registerVision() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: refresh, ...data
  });
  world(VISION_SETTING);
  world(COVER_SETTING);
  // §182: on every client, when the setting for vision cones out of combat (GM creatures) or the one for their angles by
  // creature type changes: `dnd5e-combat.conesChanged`, no argument — the displayed cones are redrawn.
  world(CONES_SETTING, { onChange: () => Hooks.callAll(`${MODULE_ID}.conesChanged`) });
  world(ANGLES_SETTING, { type: String, default: DEFAULT_ANGLES_TEXT, onChange: () => Hooks.callAll(`${MODULE_ID}.conesChanged`) });

  // Walls, lights, scene (darkness, levels), actors (senses, effects): the sources must be rebuilt.
  const stale = { label: "vision: sources to rebuild" };
  for ( const hook of ["createWall", "updateWall", "deleteWall", "createAmbientLight", "updateAmbientLight",
    "deleteAmbientLight", "updateScene", "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, () => invalidateVision(), stale);
  }
  // The declared senses read on an actor (adapter/senses.mjs): to re-read when one of its items or effects changes — an item's
  // effect (an enchantment) counts for the actor carrying the item. The turn and the world time can suspend an effect without
  // modifying it: everything is then to be re-read.
  const owner = doc => ((doc?.parent?.documentName === "Item") ? doc.parent.parent : doc?.parent) ?? null;
  const senses = { label: "vision: declared senses to read again" };
  const changed = ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"];
  for ( const hook of changed ) {
    route(hook, doc => { const actor = owner(doc); if ( actor?.documentName === "Actor" ) forgetSenses(actor); }, senses);
  }
  for ( const hook of ["updateCombat", "deleteCombat", "updateWorldTime"] ) route(hook, () => forgetSenses(), senses);
  route("canvasTearDown", () => disposeVision(), { label: "vision: sources destroyed" });
  route("canvasReady", () => disposeVision(), { label: "vision: sources destroyed" });

  route("ready", () => {
    const missing = [...checkVisionApi(), ...checkCoverApi()];
    if ( missing.length ) {
      console.warn(`${MODULE_ID} | simulated vision or cover out of service: core API missing (${missing.join(", ")})`);
      if ( game.user.isGM ) ui.notifications.warn(game.i18n.format("DND5ECOMBAT.VisionHorsService", { missing: missing.join(", ") }));
    }
    refresh();
    const state = (key, check) => game.settings.get(MODULE_ID, key) ? (check.length ? "out of service" : "in service") : "disabled (setting)";
    log(`simulated vision: ${state(VISION_SETTING, checkVisionApi())}; cover: ${state(COVER_SETTING, checkCoverApi())}`);
  }, { label: "vision: API check" });
}
