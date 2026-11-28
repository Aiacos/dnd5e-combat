/**
 * §436: dnd5e 6.1's antimagic, read in Foundry. The actor's `antimagic` status is the truth (set and removed by the
 * region behavior `dnd5e.antimagic`, dnd5e.mjs `AntimagicRegionBehaviorType`); dnd5e itself suspends `system.magical` effects
 * (`ActiveEffect5e#isSuppressed`) and the bonuses of magic items (`magicAvailable`). Here: who carries the status, where it comes
 * from, where the fields are, what a magical use is, and the `system.magical` mark that dnd5e's migration would set.
 */

import { ANTIMAGIC_STATUS, ANTIMAGIC_BEHAVIOR, isMagicalSource, isMagicalUse, shouldMarkMagical, blockedByAntimagic } from "../core/antimagic.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { originItemOf } from "./facts.mjs";
import { contentOf } from "./content.mjs";

/** Does dnd5e know the antimagic region behavior (6.1 and later)? */
export const antimagicBehaviorKnown = () => !!CONFIG.RegionBehavior?.dataModels?.[ANTIMAGIC_BEHAVIOR];

/** Does the actor carry the system's status? */
export const inAntimagic = actor => !!actor?.statuses?.has?.(ANTIMAGIC_STATUS);

/** Les faits purs d'un item (core/antimagic.mjs). */
export const itemFacts = item => item ? {
  type: item.type, subtype: item.system?.type?.value, properties: Array.from(item.system?.properties ?? []),
  magical: contentOf(item).entry?.magical === true
} : null;

/** A use that the field forbids and protects against: a cast spell, or a magic item activity (not a weapon attack). */
export const magicalUse = activity => !!activity?.item
  && isMagicalUse({ spellCast: isSpellCast(activity.item), item: itemFacts(activity.item), activityType: activity.type });

/**
 * Does dnd5e refuse this activity only because of the antimagic status (core/antimagic.mjs `blockedByAntimagic`)? The other reasons
 * to hide it are re-read as dnd5e does (`Activity#isHidden`, dnd5e.mjs:18843): hidden item, inactive dependent origin, attunement,
 * identification, level.
 */
export function antimagicBlocks(activity) {
  const item = activity?.item;
  if ( !item || !inAntimagic(activity.actor) ) return false;
  const v = activity.visibility ?? {};
  const level = activity.relevantLevel;
  const otherHidden = !!activity.isRider || !!item.isHidden || (activity.dependentOrigin?.active === false)
    || (!!v.requireAttunement && !item.system?.attuned) || (!!v.requireIdentification && !item.system?.identified)
    || ((v.level?.min ?? -Infinity) > level) || ((v.level?.max ?? Infinity) < level);
  return blockedByAntimagic({ inAntimagic: true, canUse: !!activity.canUse, itemCanUse: item.canUse, requireMagic: !!v.requireMagic,
    magicAvailable: item.system?.magicAvailable, otherHidden, magicalUse: magicalUse(activity) });
}

/** The activities of this item that only the field refuses (dnd5e's order). */
export const antimagicBlockedActivities = item => Array.from(item?.system?.activities ?? []).filter(antimagicBlocks);

/**
 * The name to show for the field where this actor stands, or null if it does not carry the status: the item that created the
 * region (its behavior is the origin of the effect), otherwise the region's name, otherwise the effect's.
 */
export function antimagicSourceName(actor) {
  if ( !inAntimagic(actor) ) return null;
  const effect = (actor.effects ?? []).find(e => e.statuses?.has?.(ANTIMAGIC_STATUS));
  const behavior = effect?.origin ? fromUuidSync(effect.origin, { strict: false }) : null;
  const region = (behavior?.documentName === "RegionBehavior") ? behavior.parent : null;
  const itemUuid = region?.getFlag?.("dnd5e", "item");
  const item = itemUuid ? fromUuidSync(itemUuid, { strict: false }) : null;
  return item?.name ?? region?.name ?? effect?.name ?? game.i18n.localize("EFFECT.DND5E.StatusAntimagic");
}

/** The scene's regions that carry an active antimagic behavior. */
export function antimagicRegions(scene) {
  return (scene?.regions ?? []).filter(r => r.behaviors?.some(b => (b.type === ANTIMAGIC_BEHAVIOR) && !b.disabled));
}

/**
 * The antimagic region that contains this token at `position` (`{ x, y, elevation }`, top-left corner of the token like
 * `_source`), or null. The core's `testInsideRegion`, like `isInside` (adapter/areas.mjs).
 */
export function antimagicRegionAt(token, position) {
  return antimagicRegions(token?.parent).find(r => token.testInsideRegion(r, position)) ?? null;
}

/** Does this region come from an activity that already sets the system's behavior (SRD 6.1)? */
export function regionHasAntimagic(region, activity) {
  if ( region.behaviors?.some(b => b.type === ANTIMAGIC_BEHAVIOR) ) return true;
  return Array.from(activity?.behaviors ?? []).some(b => b.type === "antimagic");
}

/**
 * The mark that dnd5e's migration sets (`_migrateEffectMagical`) and that an item added after it does not have (Player's
 * Handbook: none of the 294 marked spell effects): on the effects of a magic item being created.
 * Returns the number of effects marked.
 * @param {Item} item   the document being created (`preCreateItem`)
 */
export function markItemEffects(item) {
  if ( !isMagicalSource(itemFacts(item)) ) return 0;
  const effects = item._source?.effects ?? [];
  let n = 0;
  const updated = effects.map(e => {
    if ( !shouldMarkMagical({ type: e.type, magical: e.system?.magical, statuses: e.statuses }, itemFacts(item)) ) return e;
    n += 1;
    return { ...e, system: { ...(e.system ?? {}), magical: true } };
  });
  if ( n ) item.updateSource({ effects: updated });
  return n;
}

/**
 * The same mark on an effect placed on an actor whose origin item is magical (an applied spell, an aura copy, a zone's
 * effect): without it, dnd5e does not suspend it in a field. Returns true if the effect is marked.
 * @param {ActiveEffect} effect   the document being created (`preCreateActiveEffect`)
 */
export function markAppliedEffect(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return false;
  if ( !effect.system || !("magical" in effect.system) ) return false;
  const facts = { type: effect.type, magical: effect.system.magical, statuses: effect.statuses };
  if ( !shouldMarkMagical(facts, itemFacts(originItemOf(effect))) ) return false;
  effect.updateSource({ "system.magical": true });
  return true;
}

/**
 * Diagnostic (§436): the effects of a magic item **already** on a sheet without the mark — added before the world's 6.1
 * migration, or outside it. Returns their ids.
 * @param {Item} item
 */
export function unmarkedItemEffects(item) {
  const facts = itemFacts(item);
  if ( !isMagicalSource(facts) ) return [];
  return (item.effects ?? []).filter(e => shouldMarkMagical({ type: e.type, magical: e.system?.magical, statuses: e.statuses }, facts))
    .map(e => e.id);
}

/** Diagnostic (§436): the effects placed on an actor from a magic item, without the mark. Returns their ids. */
export function unmarkedAppliedEffects(actor) {
  return (actor?.effects ?? []).filter(e => e.system && ("magical" in e.system)
    && shouldMarkMagical({ type: e.type, magical: e.system.magical, statuses: e.statuses }, itemFacts(originItemOf(e))))
    .map(e => e.id);
}

/** Mark these effects of a document (item or actor). Returns the number marked. */
export async function markEffects(doc, ids) {
  const present = ids.filter(id => doc.effects?.get(id));
  if ( present.length ) await doc.updateEmbeddedDocuments("ActiveEffect", present.map(_id => ({ _id, "system.magical": true })));
  return present.length;
}

