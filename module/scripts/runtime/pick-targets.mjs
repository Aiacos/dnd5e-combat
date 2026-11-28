/**
 * §293: cast an activity "creatures of your choice within a radius" (Turn Undead) on the creatures checked in the list
 * (ui/pick-targets.mjs) — or, with the box checked, the activity that replaces it (Destroy Undead) on the same ones. The checked
 * ones become the user's targets; the activity's area is not placed (`measuredTemplate: false`) and the resolution takes the
 * message's targets (`givenTargets`, §104) instead of waiting for an area.
 */

import { MODULE_ID } from "../constants.mjs";
import { log } from "./shared.mjs";
import { targetDescriptorsOf } from "../adapter/pick-targets.mjs";
import { relaunchUse } from "./relaunch.mjs";

/**
 * @param {Activity} activity                 The activity used.
 * @param {[object, object, object]} usage     Its use, dialog and message configurations.
 * @param {object} choice
 * @param {TokenDocument[]} choice.tokens       The checked creatures.
 * @param {Activity|null} [choice.upgrade]      The activity that replaces it, if the box is checked.
 * @returns {Promise<object|null>}  The results of the use (dnd5e), or null if it did not go through.
 */
export async function castOnPicked(activity, [config, dialog, message]=[], { tokens, upgrade=null }) {
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false, groupSelection: true });
  for ( const t of tokens ) t.object?.setTarget(true, { releaseOthers: false, groupSelection: true });
  const used = upgrade ?? activity;
  const use = { ...(config ?? {}), create: { ...(config?.create ?? {}), measuredTemplate: false },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), picked: true } };
  // The suspended use's message carries empty targets (taken before the choice): the checked ones replace them.
  const msg = foundry.utils.mergeObject(message ?? {}, { data: { system: { targets: targetDescriptorsOf(tokens) },
    flags: { [MODULE_ID]: { givenTargets: true } } } }, { inplace: false });
  log(`${used.item?.name ?? used.name}: ${tokens.length} creature(s) chosen (${tokens.map(t => t.name).join(", ")})${upgrade ? ", in place of " + (activity.item?.name ?? activity.name) : ""}`);
  return (await relaunchUse(used, use, dialog ?? {}, msg)) ?? null;
}
