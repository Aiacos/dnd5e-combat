/**
 * Spells that can be recast while they last (SPEC §16.21, `recast` key): Call Lightning — "until the spell ends,
 * you can use a Magic action to call down lightning again". dnd5e 6 has only one activity: using it
 * again would spend a spell slot and restart Concentration. As long as the spell's Concentration holds, the engine
 * therefore relaunches the same use with no slot (`consume.spellSlot: false`), with no new Concentration
 * (`concentration.begin: false`), at the initial casting's level (`scaling`) — use options that dnd5e reads
 * (documents/activity/mixin.mjs:468, 494, 502). The activation (the action) is still due: the budget counts it.
 * To register BEFORE the mouse (ui/pointer.mjs): the relaunch goes back through the aiming and legality.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { stormOf, cloudOf } from "../adapter/storm.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

/** The slot level above the spell's level, read from the item's last "real" casting. */
function castScaling(item) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - 200); i-- ) {
    const m = messages[i];
    if ( (m.type !== "usage") || m.getFlag(MODULE_ID, "recast") || m.getFlag(MODULE_ID, "areaTick") ) continue;
    if ( m.system?.item?.uuid !== item.uuid ) continue;
    return Number(m.system?.scaling) || 0;   // `system.scaling` of the use message (levels above the spell)
  }
  return 0;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  if ( usageConfig[MODULE_ID]?.recast || !activity?.item ) return true;
  if ( !contentOf(activity.item).entry?.recast || !concentrationOn(activity.item) ) return true;
  const consume = (usageConfig.consume && (typeof usageConfig.consume === "object")) ? usageConfig.consume : {};
  // dnd5e recomputes `scaling` from the chosen slot: we give it that of the casting, which will not be spent.
  const scaling = castScaling(activity.item);
  const config = {
    ...usageConfig,
    consume: { ...consume, spellSlot: false },
    concentration: { ...(usageConfig.concentration ?? {}), begin: false },
    scaling,
    ...(scaling > 0 ? { spell: { ...(usageConfig.spell ?? {}), slot: `spell${(activity.item.system.level ?? 0) + scaling}` } } : {}),
    [MODULE_ID]: { ...(usageConfig[MODULE_ID] ?? {}), recast: true }
  };
  // §70: a storm spell whose cloud is there — no new area to place: the bolt is aimed from beneath (ui/pointer.mjs).
  if ( stormOf(activity.item) && cloudOf(activity.item) ) config.create = { ...(usageConfig.create ?? {}), measuredTemplate: false };
  log(`${activity.item.name}: recast without a spell slot (concentration ongoing)`);
  relaunchUse(activity, config, { ...(dialogConfig ?? {}), configure: false }, messageConfig);
  return false;
}

export function registerRecast() {
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "recast of a lasting spell" });
}
