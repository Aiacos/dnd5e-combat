/**
 * Enchanting a chosen creature's weapon (SPEC §16.41, key `enchantTarget`: Elemental Weapon). dnd5e 6 applies an
 * enchantment through `EnchantActivity#applyEnchantment` (documents/activity/enchant.mjs:151): the activity's duration
 * (`getAppliedEffectChanges`, mixin.mjs:1205), link to Concentration (`flags.dnd5e.dependentOn`: removed when it drops),
 * checked restrictions (`canEnchant`, enchant.mjs:237: not an already magical weapon…). What was missing: choosing the creature
 * and its weapon (dnd5e expects a drag-and-drop onto the card), and applying it to another character's weapon (the active GM).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";

/** What this activity's enchantment targets ("weapon", "ownWeapon"), or null. */
export function enchantTargetOf(activity) {
  return (activity?.type === "enchant") && activity.item ? (contentOf(activity.item).entry?.enchantTarget ?? null) : null;
}

/** This actor's weapons, and for each what prevents it from being enchanted (null if nothing). */
export function enchantableWeapons(activity, actor) {
  return (actor?.items ?? []).filter(i => i.type === "weapon").map(item => {
    const errors = activity.canEnchant?.(item) ?? [];
    return { uuid: item.uuid, name: item.name, img: item.img, refusal: errors.length ? errors.map(e => e.message).join(" ") : null };
  });
}

/** The item's pact rule (`pact`), or null. */
export function pactRuleOf(item) {
  return item ? (contentOf(item).entry?.pact ?? null) : null;
}

/** §16.45: its own weapons that the pact accepts (not the Unarmed Strike, which is a "natural" weapon). */
export function ownPactWeapons(activity) {
  return enchantableWeapons(activity, activity.actor).filter(w => fromUuidSync(w.uuid)?.system?.type?.value !== "natural");
}

/** §16.45: the pact weapon is chosen from the dnd5e compendium — melee, simple or martial, non-magical. */
export function pickConjuredWeapon() {
  const locked = { documentClass: "Item", types: new Set(["weapon"]), additional: { type: { simpleM: 1, martialM: 1 }, properties: { mgc: -1 } } };
  return dnd5e.applications.CompendiumBrowser.selectOne({ filters: { locked } });
}

/**
 * §16.45: summons the weapon into the inventory (a copy of the compendium weapon, marked `flags["dnd5e-combat"].conjuredBy` = uuid
 * of the pact item); weapons previously summoned by this pact disappear. On the caster's client. Returns the weapon.
 */
export async function conjureWeapon(activity, sourceUuid) {
  const actor = activity.actor;
  const source = await fromUuid(sourceUuid);
  if ( !source ) return null;
  const old = actor.items.filter(i => i.getFlag(MODULE_ID, "conjuredBy") === activity.item.uuid).map(i => i.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);
  const data = source.toObject();
  delete data._id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.conjuredBy`, activity.item.uuid);
  foundry.utils.setProperty(data, "system.equipped", true);
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  return item ?? null;
}

/** Applies the chosen enchantment to the weapon (active GM: the weapon may be another character's). */
export async function applyEnchantmentTo(activity, item, { profile, message=null, concentration=null }) {
  return activity.applyEnchantment(profile, item, { chatMessage: message, concentration, strict: true });
}
