/**
 * M7 (SPEC §18.11): the Emanations an actor carries (content `emanation`, by identifier), seen from Foundry — activity,
 * radius (template, otherwise the activity's range), what the original English text says — and the immunity that a successful
 * save leaves on the target (an effect with a duration, native core expiration: `duration.units: "hours"`).
 */

import { MODULE_ID } from "../constants.mjs";
import { readEmanationText } from "../core/emanation.mjs";
import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";
import { originItemOf } from "./facts.mjs";

const ACTING = ["save", "damage", "attack"];

/** The activity that acts: the one the content names, otherwise the first save, then damage, then attack. */
function actingActivity(item, rule) {
  const activities = item.system.activities;
  if ( rule.activity ) return activities?.get(rule.activity) ?? null;
  for ( const type of ACTING ) {
    const found = activities?.find(a => a.type === type);
    if ( found ) return found;
  }
  return null;
}

/** Emanation radius: the content (value, or §92 formula read on the bearer), the activity's template, its range. */
function radiusOf(activity, rule) {
  if ( rule.radiusFormula ) {
    let r = NaN;
    try { r = Number(dnd5e.utils.simplifyBonus(rule.radiusFormula, activity.actor?.getRollData?.() ?? {})); } catch { /* formule illisible */ }
    if ( r > 0 ) return { radius: r, units: rule.units };
  }
  if ( rule.radius ) return { radius: rule.radius, units: rule.units };
  const template = activity.target?.template;
  const size = Number(template?.size);
  if ( template?.type && (size > 0) ) return { radius: size, units: template.units || "ft" };
  const range = Number(activity.range?.value);
  if ( range > 0 ) return { radius: range, units: activity.range.units || "ft" };
  return null;
}

/**
 * An actor's Emanations.
 * @returns {Array<{item: Item5e, activity: Activity, key: string, on: string, affects: string, sees: boolean,
 *   radius: number, units: string, active: boolean, kin: boolean, immunity: {hours: number, all: boolean}|null}>}
 */
export function emanationsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.emanation;
    if ( !rule?.on ) continue;
    // §92: "for 10 minutes" (Avenging Angel) — only while an effect of the item is on the bearer.
    // `appliedEffects`: those of the actor AND those its items transfer to it ("Savage Wrath": the "Ancestral Armor" enchantment).
    if ( rule.whileActive && !(actor.appliedEffects ?? actor.effects ?? []).some(e => !e.disabled && !e.isSuppressed && (originItemOf(e)?.uuid === item.uuid)) ) continue;
    const activity = actingActivity(item, rule);
    const reach = activity ? radiusOf(activity, rule) : null;
    if ( !reach ) {
      console.warn(`${MODULE_ID} | emanation "${item.name}" of ${actor.name} ignored: ${activity ? "unknown radius" : "no activity that acts"}`);
      continue;
    }
    out.push({ item, activity, key: item.system.identifier || item.id, on: rule.on, affects: rule.affects ?? "any", atStart: rule.atStart === true,
      sees: rule.sees === true, ...reach, ...readEmanationText(englishDescription(item)) });
  }
  return out;
}

/** Does this actor carry an Emanation of this name ("other than a Ghast")? */
export function carriesEmanation(actor, key) {
  return emanationsOf(actor).some(e => e.key === key);
}

/** Immune to this Emanation (this bearer's, or all those of this name)? */
export function isImmuneTo(actor, key, sourceUuid) {
  return (actor?.effects ?? []).some(e => {
    const flag = e.active ? e.getFlag(MODULE_ID, "emanationImmune") : null;
    return !!flag && (flag.key === key) && (flag.all || (flag.source === sourceUuid));
  });
}

/**
 * Successful save: "immune to the aura of this … for 24 hours". An effect with a duration on the target, saying against
 * what; the core suspends it when world time has passed the duration. Active GM.
 * @param {Actor5e} actor
 * @param {{item: Item5e, key: string, immunity: {hours: number, all: boolean}}} emanation
 * @param {TokenDocument} source
 */
export async function grantImmunity(actor, emanation, source) {
  if ( !actor || !emanation.immunity || isImmuneTo(actor, emanation.key, source.uuid) ) return;
  const { hours, all } = emanation.immunity;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format(all ? "DND5ECOMBAT.Emanation.ImmuniteToutes" : "DND5ECOMBAT.Emanation.Immunite",
      { item: emanation.item.name, source: source.name }),
    img: emanation.item.img,
    origin: emanation.item.uuid,
    duration: { value: hours, units: "hours" },
    flags: { [MODULE_ID]: { emanationImmune: { key: emanation.key, source: all ? null : source.uuid, all } } }
  }]);
}
