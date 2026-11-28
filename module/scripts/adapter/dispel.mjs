/**
 * §37.2: Dispel Magic (core/dispel.mjs) on the Foundry side — the spells running on a creature, and how to end them.
 *
 * Verified in dnd5e 6.0.3:
 *  - an effect placed by the effects panel carries `flags.dnd5e.spellLevel` (casting level), `flags.dnd5e.dependentOn`
 *    (the caster's Concentration effect) and `system.origin.message` (the use message) — effect-application.mjs,
 *    `_prepareEffectData`;
 *  - deleting the Concentration effect deletes its dependents, on the active GM (documents/active-effect.mjs:836-849,
 *    `getDependents` :1105): ending a Concentration spell means removing its caster's Concentration.
 */

import { MODULE_ID } from "../constants.mjs";
import { originItemOf } from "./facts.mjs";
import { zoneCenter } from "./areas.mjs";
import { isSpellCast, spellLevelOf } from "./scrolls.mjs";
import { identifierOf } from "./content.mjs";

const isConcentration = effect => effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration");

/**
 * The spells running on an actor, one per casting: the effects coming from a spell item (except the Concentration the actor holds
 * itself), grouped by the Concentration they depend on, otherwise by the message that placed them.
 * @param {Actor} actor
 * @param {{except?: Item|null}} [options]  The spell not to count (Dispel Magic itself).
 * @returns {Array<{key: string, level: number, name: string, concentration: string|null, effects: ActiveEffect[]}>}
 */
export function spellsOn(actor, { except=null }={}) {
  const groups = new Map();
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || isConcentration(effect) ) continue;
    const item = originItemOf(effect);
    if ( !isSpellCast(item) || (except && (identifierOf(item).id === identifierOf(except).id) && (item.actor === except.actor)) ) continue;
    const concentration = effect.getFlag?.("dnd5e", "dependentOn") ?? null;
    const key = concentration ?? effect.system?.origin?.message ?? effect.uuid;
    const level = Number(effect.getFlag?.("dnd5e", "spellLevel")) || spellLevelOf(item);
    const group = groups.get(key) ?? { key, level, name: item.name, concentration, effects: [] };
    group.level = Math.max(group.level, level);
    group.effects.push(effect);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * The spell ends: its Concentration removed (dnd5e removes everything that depends on it; the engine removes its areas), otherwise
 * its effects on the creature, or its area (§403). Active GM.
 */
export async function endSpell(group) {
  const concentration = group.concentration ? await fromUuid(group.concentration) : null;
  if ( concentration ) return concentration.delete();
  if ( group.region?.parent?.regions?.has(group.region.id) ) await group.region.delete();
  for ( const effect of group.effects ) if ( effect.parent?.effects?.has(effect.id) ) await effect.delete();
}

/** The caster's spellcasting ability for this spell: the spell's own, otherwise the actor's, otherwise Wisdom. */
export function castingAbilityOf(item, actor) {
  return item?.system?.ability || actor?.system?.attributes?.spellcasting || "wis";
}

/** The caster's ability check against this DC; its total, or null if it did not take place. */
export async function castingCheck(actor, ability, dc, { bonus=0 }={}) {
  const rolls = await actor.rollAbilityCheck({ ability, target: dc }, { configure: false });
  const total = rolls?.[0]?.total ?? null;
  return (total === null) ? null : total + bonus;
}

/**
 * §403: the spell areas of the scene (regions placed by a spell activity: `flags.dnd5e.activity`) within the caster's range
 * — measured from its token to the center of the area, in the grid unit —, each as a spell in progress: its casting level
 * (`flags.dnd5e.spellLevel`, otherwise the item's), the Concentration that holds it (`flags.dnd5e-combat.concentration`).
 * @param {TokenDocument} caster
 * @param {number} range  In the grid unit.
 * @param {{except?: Item|null}} [options]
 * @returns {Array<{key: string, level: number, name: string, concentration: string|null, effects: ActiveEffect[],
 *   region: RegionDocument}>}
 */
export function spellZonesNear(caster, range, { except=null }={}) {
  const scene = caster?.parent;
  if ( !scene ) return [];
  // §406: the validated position — `object.center` follows the animation (V14 trap, adapter/turn.mjs `committedPosition`).
  const from = caster.getCenterPoint(caster._source);
  const pxPerUnit = scene.grid.size / scene.grid.distance;
  const out = [];
  for ( const region of scene.regions ) {
    const uuid = region.getFlag?.("dnd5e", "activity");
    const item = uuid ? fromUuidSync(uuid, { strict: false })?.item : null;
    if ( !isSpellCast(item) || (except && (item === except)) ) continue;
    const center = zoneCenter(region);
    if ( from && center && (Math.hypot(center.x - from.x, center.y - from.y) / pxPerUnit > range + 1e-6) ) continue;
    const level = Number(region.getFlag("dnd5e", "spellLevel")) || spellLevelOf(item);
    out.push({ key: region.uuid, level, name: item.name, caster: item.actor?.name ?? "", concentration: region.getFlag(MODULE_ID, "concentration") ?? null, effects: [], region });
  }
  return out;
}
