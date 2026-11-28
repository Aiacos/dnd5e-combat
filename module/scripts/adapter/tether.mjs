/**
 * Caster → creature link (SPEC §16.43, key `tether`: Witch Bolt), read and written in Foundry. dnd5e applies the
 * "Continuous Lightning" effect only on a hit; the rule keeps the link even if the attack misses. The engine therefore records the
 * creature targeted by the attack, hit or missed: `flags["dnd5e-combat"].tethers.<id d'item>` = uuid of its token, on the caster.
 * The link holds only as long as the spell's Concentration holds.
 */

import { MODULE_ID } from "../constants.mjs";
import { tetherBreak } from "../core/tether.mjs";
import { contentOf } from "./content.mjs";
import { concentrationOn } from "./summons.mjs";
import { distanceBetween } from "./turn.mjs";
import { coverFor, hasLineOfEffect } from "./cover.mjs";
import { tokenOnViewedScene } from "./vision.mjs";
import { lengthIn } from "./units.mjs";

/** An item's link rule, or null. */
export function tetherRuleOf(item) {
  return item ? (contentOf(item).entry?.tether ?? null) : null;
}

/** The item that carries this link activity (attack or following action), and its rule. */
export function tetherOfActivity(activity) {
  const rule = tetherRuleOf(activity?.item);
  if ( !rule ) return null;
  if ( activity.id === rule.attack ) return { rule, role: "attack" };
  if ( activity.id === rule.activity ) return { rule, role: "follow" };
  return null;
}

/** The token linked by this item, as long as its Concentration holds; otherwise null. */
export function tetheredToken(item) {
  const uuid = item?.actor?.getFlag(MODULE_ID, `tethers.${item.id}`);
  if ( !uuid || !concentrationOn(item) ) return null;
  const token = fromUuidSync(uuid, { strict: false });
  return token?.actor ? token : null;
}

/** Records the link, on use of the attack (active GM). `targetUuid`: the targeted token. */
export async function recordTether(item, targetUuid) {
  await item.actor.setFlag(MODULE_ID, `tethers.${item.id}`, targetUuid);
}

/** Forgets the link (end of the spell). */
export async function clearTether(item) {
  if ( item?.actor?.getFlag(MODULE_ID, `tethers.${item.id}`) ) await item.actor.unsetFlag(MODULE_ID, `tethers.${item.id}`);
}

/** The items of this actor whose link is recorded. */
export function tetherItems(actor) {
  const tethers = actor?.getFlag(MODULE_ID, "tethers") ?? {};
  return Object.keys(tethers).map(id => actor.items.get(id)).filter(Boolean);
}

/**
 * Is the link broken? "leaves its range" (3D distance between the tokens, grid unit); "Total Cover" (walls,
 * surfaces). Returns "range", "cover" or null (or null if it cannot be judged: different scenes, canvas absent).
 */
export function tetherBroken(item) {
  const rule = tetherRuleOf(item);
  const target = tetheredToken(item);
  const caster = tokenOnViewedScene(item?.actor);
  if ( !rule || !target || !caster || (caster.parent !== target.parent) ) return null;
  let maxRange = lengthIn(rule.range.value, rule.range.units, caster.parent.grid.units);
  const distance = distanceBetween(caster, target).value;
  const totalCover = (hasLineOfEffect(caster, target) === false) || (coverFor(caster, target, { quiet: true })?.degree === "total");
  return tetherBreak({ distance, maxRange, totalCover });
}
