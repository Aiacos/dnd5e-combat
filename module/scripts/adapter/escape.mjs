/**
 * Freeing oneself with a check (SPEC §16.54): the Restrained effects of an actor whose origin item writes the escape check
 * in its text (core/escape.mjs). The DC is computed on the creature that placed the restraint (`@attributes.spell.dc` of the
 * caster, `@abilities.str.dc` or `@skills.ath.passive` of the monster), through dnd5e's `simplifyBonus` like auras.
 */

import { parseEscapeCheck, escapableStatuses } from "../core/escape.mjs";
import { originItemOf } from "./facts.mjs";
import { englishDescription } from "./multiattack.mjs";

/** The escape check an item writes, or null. */
export function escapeCheckOf(item) {
  if ( !item ) return null;
  // A spell writes its check "against your spell save DC": absent a DC in the enricher (imported texts), that one.
  const known = { abilities: Object.keys(CONFIG.DND5E?.abilities ?? {}), skills: Object.keys(CONFIG.DND5E?.skills ?? {}),
    defaultDc: (item.type === "spell") ? "@attributes.spell.dc" : null };
  return parseEscapeCheck(englishDescription(item), known) ?? parseEscapeCheck(item.system?.description?.value, known);
}

/** Does the item place Restrained (one of its effects)? For the badge: a written escape check only counts there. */
export const restrainsWith = item => (item?.effects ?? []).some(e => escapableStatuses(Array.from(e.statuses ?? [])));

/** The DC of an escape check, evaluated on the actor that carries the origin item. null if unreadable. */
export function dcOf(check, item) {
  const n = Number(check.dc);
  if ( Number.isFinite(n) ) return n;
  const data = item.actor?.getRollData?.() ?? {};
  const value = Number(dnd5e.utils.simplifyBonus(check.dc, data));
  return (Number.isFinite(value) && (value > 0)) ? value : null;
}

/**
 * The restraints the actor can free itself from with a check.
 * @returns {Array<{effect: ActiveEffect, item: Item5e, ability: string|null, skill: string|null, dc: number}>}
 */
export function escapableRestraintsOf(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed || !escapableStatuses(Array.from(effect.statuses ?? [])) ) continue;
    const item = originItemOf(effect);
    const check = escapeCheckOf(item);
    const dc = check ? dcOf(check, item) : null;
    if ( dc !== null ) out.push({ effect, item, ability: check.ability, skill: check.skill, dc });
  }
  return out;
}
