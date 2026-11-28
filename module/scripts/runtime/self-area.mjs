/**
 * A "self" area is placed automatically on the caster (SPEC §47), with no window or click.
 *
 *  - `dnd5e.preUseActivity`: dnd5e provides for the placement (`create.measuredTemplate`, documents/activity/mixin.mjs:451),
 *    and this one checkbox is enough to open its use window (`_requiresConfigurationDialog`, mixin.mjs:688-694: "Place
 *    Template"). We uncheck it and hide it (`display.create`, applications/activity/activity-usage-dialog.mjs:329): the
 *    window only opens if there is something else to choose in it (slot, Concentration…).
 *  - `dnd5e.postUseActivity`: the use done, the region is created by the engine (adapter/self-area.mjs), where dnd5e
 *    would have placed it in `_finalizeUsage` (mixin.mjs:832) — after the card, like it.
 *  - `dnd5e.preCreateMeasuredTemplate` (Hooks.call, canvas/template-placement.mjs:115): the "Place Area" button of the
 *    card still goes through interactive placement; we refuse it and create the region ourselves.
 * These hooks are synchronous: the creation goes to the background — dnd5e reads nothing of the area afterwards
 * (`results.templates`), the resolution follows `createRegion`.
 *
 * On the client of whoever uses the activity, player included.
 *
 * §59: a Cone or Line with self range is aimed around the caster (the aiming is in ui/pointer.mjs, before
 * legality); the click relaunches the use through `castAimed`, the aimed shape in `usageConfig["dnd5e-combat"].aimed`, without the
 * "Place Template" checkbox; the region is created here at `dnd5e.postUseActivity`, like the self area.
 */

import { MODULE_ID } from "../constants.mjs";
import { selfAreaOf, placeSelfArea, aimedAreaOf, placeAimedArea, wallAreaOf, placeWallArea, teleportAreaOf, placeArrivalArea } from "../adapter/self-area.mjs";
import { carriedLightOf } from "../adapter/carried-lights.mjs";
import { suppliesTemplate, withTemplate } from "../adapter/template.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

function place(activity, area) {
  placeSelfArea(activity, area).then(created => {
    if ( created?.length ) log(`${activity.item?.name ?? activity.name}: area placed on ${area.token.name} (${area.shape})`);
  }, err => {
    console.error(`${MODULE_ID} | self area not placed`, err);
    ui.notifications.warn("DND5ECOMBAT.ZoneSurSoiNonPosee", { localize: true });
  });
}

function onPreUse(activity, usageConfig, dialogConfig) {
  // §463: the area of an "on arrival" teleportation is not placed on use: after the jump (runtime/teleport.mjs,
  // `afterTeleport`), around the creature that arrived.
  if ( teleportAreaOf(activity) === "arrival" ) {
    usageConfig.create = { ...(usageConfig.create ?? {}), measuredTemplate: false };
    if ( dialogConfig ) {
      dialogConfig.options ??= {};
      dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
    }
    return;
  }
  // §86: a template supplied by the content — dnd5e provided nothing to place (no area type in the data).
  const supplied = suppliesTemplate(activity);
  // §91: supplied, and not self (touch or ranged range: Forbiddance) — placed with the mouse after use, as dnd5e
  // would; unless the caller itself gave up the placement (`measuredTemplate: false`: test tools, which place the area).
  if ( supplied && !selfAreaOf(activity) ) {
    if ( usageConfig?.create?.measuredTemplate !== false ) (usageConfig[MODULE_ID] ??= {}).pointZone = true;
    return;
  }
  // §438: an activity whose area carries dnd5e behaviors (`behaviors`: the effect's aura, Speed halved)
  // only has an effect through its area; the Player's Handbook 3.0.0 leaves some at `target.prompt: false` (Aura of Purity,
  // Aura of Life), which dnd5e would not place (dnd5e.mjs:19142, `measuredTemplate ??= type && prompt`): on self, the
  // Emanation is placed anyway — unless the area was already supplied by the caller (`areaPlaced`: test tools).
  const behavioral = (activity?.target?.prompt === false) && (activity?.applicableBehaviors?.length > 0)
    && !usageConfig?.[MODULE_ID]?.areaPlaced;
  if ( ((usageConfig?.create?.measuredTemplate !== true) && !supplied && !behavioral) || !selfAreaOf(activity) ) return;
  usageConfig.create = { ...(usageConfig.create ?? {}), measuredTemplate: false };
  (usageConfig[MODULE_ID] ??= {}).selfArea = true;
  if ( dialogConfig ) {
    dialogConfig.options ??= {};
    dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
  }
}

/**
 * §59: intent "cast toward this direction" — the aimed shape (ui/pointer.mjs); the use restarts without the
 * "Place Template" checkbox and without a window (the level was chosen before the aiming), the area is placed at `postUseActivity`.
 * @param {Activity} activity
 * @param {[object, object, object]} usage  Use, dialog and message configurations received.
 * @param {object} shapeData                The aimed shape (`aimedShapeData`).
 * @returns {Promise<boolean>}  true if the activity was launched.
 */
export async function castAimed(activity, [config, dialog, message]=[], shapeData) {
  const use = { ...(config ?? {}), create: { ...(config?.create ?? {}), measuredTemplate: false },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), aimed: shapeData } };
  return !!(await relaunchUse(activity, use, { ...(dialog ?? {}), configure: false }, message));
}

/**
 * §59: intent "place the aimed area" without relaunching the activity (card's "Place Area" button).
 * @param {Activity} activity
 * @param {object} shapeData
 */
export function placeAimed(activity, shapeData) {
  const area = aimedAreaOf(activity);
  if ( area ) placeAimedShape(activity, area, shapeData);
}

function placeAimedShape(activity, area, shapeData) {
  placeAimedArea(activity, area, shapeData).then(created => {
    if ( created?.length ) log(`${activity.item?.name ?? activity.name}: ${area.shape} aimed from ${area.token.name} (${Math.round(shapeData.rotation)}°)`);
  }, err => {
    console.error(`${MODULE_ID} | aimed area not placed`, err);
    ui.notifications.warn("DND5ECOMBAT.ZoneSurSoiNonPosee", { localize: true });
  });
}

/** §162: places the drawn wall (points) — intent of the point-by-point aiming (ui/pointer.mjs). */
export function placeWall(activity, points) {
  const area = wallAreaOf(activity);
  if ( !area ) return Promise.resolve(null);
  return placeWallArea(activity, area, points).then(created => {
    if ( created?.length ) log(`${activity.item?.name ?? activity.name}: wall placed through ${points.length} points`);
    return created;
  }, err => {
    console.error(`${MODULE_ID} | wall not placed`, err);
    return null;
  });
}

function onPostUse(activity, usageConfig, results) {
  const aimed = usageConfig?.[MODULE_ID]?.aimed;
  // §162: a wall aimed by points.
  if ( aimed?.type === "wall" ) {
    if ( results ) placeWall(activity, aimed.points ?? []);
    return;
  }
  if ( aimed ) {
    const area = results ? aimedAreaOf(activity) : null;
    if ( area ) placeAimedShape(activity, area, aimed);
    return;
  }
  if ( usageConfig?.[MODULE_ID]?.pointZone && results ) {
    dnd5e.canvas.TemplatePlacement.fromActivity(withTemplate(activity)).catch(err => console.error(`${MODULE_ID} | provided area not placed`, err));
    return;
  }
  if ( !usageConfig?.[MODULE_ID]?.selfArea ) return;
  const area = selfAreaOf(activity);
  if ( area ) place(activity, area);
}

function onPreTemplate(activity) {
  // §254: a carried light source has no area — its light is on the token (§121). The "Place Template" button of its card
  // would make dnd5e place an Emanation attached to the bearer.
  if ( carriedLightOf(activity?.item) ) return false;
  // §463: the "Place Area" button of a teleportation with an arrival area (aiming cut off, jump done by hand): around the
  // token, where it is.
  if ( teleportAreaOf(activity) === "arrival" ) {
    const token = activity.getUsageToken?.() ?? null;
    if ( token ) placeArrivalArea(activity, token).catch(err => console.error(`${MODULE_ID} | arrival area not placed`, err));
    return false;
  }
  const area = selfAreaOf(activity);
  if ( !area ) return;
  place(activity, area);
  return false;
}

export function registerSelfAreas() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "self area: without the \"Place Template\" box" });
  route("dnd5e.postUseActivity", onPostUse, { label: "self area: automatic placement" });
  route("dnd5e.preCreateMeasuredTemplate", onPreTemplate, { cancellable: true, label: "self area: automatic placement (canvas)" });
}
