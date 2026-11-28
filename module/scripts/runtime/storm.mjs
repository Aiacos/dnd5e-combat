/**
 * §70: the storm of Call Lightning — the intentions (adapter/storm.mjs does the writes, ui/pointer.mjs the aiming).
 *
 *  - `dressStorm`: the cloud that dnd5e has just placed is dressed as a storm, "already there" noted (+1d10);
 *  - `strike`: the bolt is placed at the aimed point, brought back under the cloud;
 *  - `dnd5e.preRollDamageV2`: the damage of a bolt fired from an already-there storm receives the extra die (`storm.bonus`);
 *  - `launchStrike` (§469): when the casting only places the cloud (Player's Handbook 3.0.0), the bolt's activity is used
 *    right after, spending nothing and placing nothing — it is what the aimed bolt resolves.
 * The aiming in progress (`boltAim`) is noted here so that the test functions (runtime/testing.mjs) can play the click.
 */

import { MODULE_ID } from "../constants.mjs";
import { stormOf, cloudOf, cloudCircle, dressCloud, placeBolt, isBoltRegion } from "../adapter/storm.mjs";
import { clampToCircle } from "../core/storm.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

let aiming = null;

/** The aiming of a bolt in progress on this client (`{ activity, cloud }`), or null. */
export const boltAim = () => aiming;
export function setBoltAim(value) { aiming = value; }

/** The cloud that the last casting has just placed (the item's region, neither a bolt nor already dressed), or null. */
export function freshCloudOf(item, scene=canvas?.scene) {
  const regions = scene?.regions.filter(r => (r.getFlag("dnd5e", "item") === item.uuid) && !isBoltRegion(r) && !r.getFlag(MODULE_ID, "cloud")) ?? [];
  return regions.at(-1) ?? null;
}

/** The casting, once the storm question is answered (ui/pointer.mjs): the same use, the answer noted. */
export function castStorm(activity, [usageConfig, dialogConfig, messageConfig], stormy) {
  return relaunchUse(activity, { ...usageConfig, [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), stormy: !!stormy } }, dialogConfig, messageConfig);
}

/** Dresses the cloud just placed. */
export async function dressStorm(activity, cloud, { stormy=false }={}) {
  const { fx } = await dressCloud(cloud, { stormy });
  log(`${activity.item.name}: storm placed (${fx ? "FXMaster: rain and lightning" : "dark area"})${stormy ? ", storm already there: +" + (stormOf(activity.item)?.bonus ?? "") : ""}`);
}

/**
 * §469: the activity that carries the bolt. An activity that has its own saving throw or damage carries it itself (Player's
 * Handbook 2.2.0, or the "Lightning Strike" activity used directly); otherwise ("Cast Spell" of Player's Handbook 3.0.0, which
 * only places the cloud) the one the rule names (`storm.strike`), failing that the item's first saving throw that is not the
 * "storm" variant (`storm.stormStrike`).
 */
export function strikeActivityOf(activity) {
  if ( !activity?.item ) return null;
  if ( (activity.type === "save") || activity.damage?.parts?.length ) return activity;
  const rule = stormOf(activity.item);
  const activities = activity.item.system.activities;
  return activities?.get(rule?.strike ?? "") ?? activities?.find(a => (a.type === "save") && (a.id !== rule?.stormStrike)) ?? null;
}

/**
 * §469: the bolt of a casting that only places the cloud — the bolt's activity, used like a relaunch (§16.21): no
 * slot, no new Concentration, no area to place (the bolt is aimed under the cloud at the end of this use),
 * at the level of the casting.
 */
export function launchStrike(cast, strikeActivity, usageConfig) {
  const scaling = Number(usageConfig?.scaling) || 0;
  log(`${cast.item.name}: the cast only placed the cloud, the lightning uses "${strikeActivity.name}"`);
  return relaunchUse(strikeActivity, {
    consume: { spellSlot: false, resources: false },
    concentration: { begin: false },
    create: { measuredTemplate: false },
    scaling,
    ...(scaling > 0 ? { spell: { slot: `spell${(cast.item.system.level ?? 0) + scaling}` } } : {}),
    [MODULE_ID]: { ...(usageConfig?.[MODULE_ID] ?? {}), recast: true, strikeOf: cast.id }
  }, { configure: false }, {});
}

/** The bolt at the aimed point (pixels), brought back under the cloud. */
export async function strike(activity, cloud, point) {
  const circle = cloudCircle(cloud);
  const at = circle ? clampToCircle(point, circle.center, circle.radius) : point;
  const region = await placeBolt(activity, cloud, at);
  if ( region ) log(`${activity.item.name}: lightning bolt at (${Math.round(at.x)}, ${Math.round(at.y)})`);
  return region;
}

/** The damage of a bolt, when the storm was already there: the extra die. */
function onPreRollDamage(config) {
  const item = config?.subject?.item;
  const rule = stormOf(item);
  if ( !rule?.bonus || !cloudOf(item)?.getFlag(MODULE_ID, "stormy") ) return true;
  // §469: the "storm already there" variant of Player's Handbook 3.0.0 already carries the extra die.
  if ( rule.stormStrike && (config.subject?.id === rule.stormStrike) ) return true;
  const roll = config.rolls?.[0];
  if ( !roll ) return true;
  roll.parts = [...(roll.parts ?? []), rule.bonus];
  log(`${item.name}: storm already there, +${rule.bonus}`);
  return true;
}

/**
 * The cloud's region stays invisible (`LAYER`): in the test of 2026-10-04, an update coming from elsewhere set it back to "GM"
 * after the dressing (source not found). Any update of its visibility is brought back here, on the client that makes it.
 */
function onPreUpdateRegion(region, changes) {
  const cloud = region.getFlag(MODULE_ID, "cloud") || foundry.utils.getProperty(changes, `flags.${MODULE_ID}.cloud`);
  if ( !cloud || !("visibility" in changes) || (changes.visibility === CONST.REGION_VISIBILITY.LAYER) ) return;
  changes.visibility = CONST.REGION_VISIBILITY.LAYER;
  log(`storm: cloud visibility kept hidden`);
}

export function registerStorm() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "storm: extra die not added" });
  route("preUpdateRegion", onPreUpdateRegion, { label: "storm: cloud made visible" });
}
