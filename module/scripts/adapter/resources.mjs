/**
 * §410 (issue #44, batch 3): what is missing for a use — spell slot, uses, quantity, preparation (pure rule:
 * core/resources.mjs). dnd5e only refuses it when spending, after `dnd5e.preUseActivity` (`Activity#use`, dnd5e.mjs:17696; slot
 * :18067; uses `_usesConsumption` :5016; materials `consumeMaterial` :4941; consumed slots `consumeSpellSlots` :4978):
 * the engine judges it before, in the legality window, and a player who forces re-rolls without spending anything (`forced` of §77,
 * runtime/usage.mjs).
 */

import { isShort, plainCost, resourceIssues, slotLeft, awaitsPreparation } from "../core/resources.mjs";
import { ritualModeOf } from "./grimoire.mjs";

/** The level of a slot consumed by a "spellSlots" target (its target, plus the increase per level). */
function slotTargetLevel(target, scaling) {
  const base = Number(target.target) || 1;
  return base + ((target.scaling?.mode === "level") ? (Number(scaling) || 0) : 0);
}

/**
 * The activity's consumptions that dnd5e will spend, with what remains: `{ index, kind, available, cost }`. Without a
 * configuration (bar cell): those dnd5e would spend by default (`_prepareUsageConfig`, dnd5e.mjs:17862: outside combat,
 * not the "combat only" ones).
 */
function spentTargets(activity, usageConfig) {
  const actor = activity.actor;
  const chosen = Array.isArray(usageConfig?.consume?.resources) ? new Set(usageConfig.consume.resources) : null;
  if ( usageConfig?.consume === false ) return [];
  const out = [];
  for ( const [index, target] of Array.from(activity.consumption?.targets ?? []).entries() ) {
    if ( chosen ? !chosen.has(index) : (target.combatOnly && !actor?.inCombat) ) continue;
    const cost = plainCost(target.value);
    if ( target.type === "activityUses" ) out.push({ index, kind: "uses", available: Number(activity.uses?.value) || 0, cost, max: activity.uses?.max });
    else if ( target.type === "itemUses" ) {
      const item = target.target ? actor?.items?.get(target.target) : activity.item;
      if ( item ) out.push({ index, kind: "uses", available: Number(item.system.uses?.value) || 0, cost, max: item.system.uses?.max });
    }
    else if ( target.type === "material" ) {
      const item = actor?.items?.get(target.target);
      if ( item ) out.push({ index, kind: "quantity", available: Number(item.system.quantity) || 0, cost });
    }
    else if ( target.type === "spellSlots" ) {
      const level = slotTargetLevel(target, usageConfig?.scaling);
      out.push({ index, kind: "slot", available: slotLeft(actor?.system?.spells, level) ? 1 : 0, cost: 1 });
    }
  }
  // A limit without a maximum (empty "uses") does not count.
  return out.filter(t => (t.kind !== "uses") || (Number(t.max) > 0) || (typeof t.max === "string" && t.max !== ""));
}

/**
 * Does this sheet spell await preparation (core/resources.mjs, `awaitsPreparation`)? Read on the item; not for anything
 * but a spell (a scroll is cast without preparation).
 * @param {Item} item
 */
export function unpreparedSpell(item) {
  if ( item?.type !== "spell" ) return false;
  return awaitsPreparation({ level: item.system.level, prepared: item.system.prepared,
    prepares: !!CONFIG.DND5E?.spellcasting?.[item.system.method]?.prepares });
}

/**
 * What is missing for this use. `keys`: the reasons (`noSlot`, `noUses`, `noQuantity`, `unprepared`); `skip`: what a player
 * who forces does not spend (`spellSlot`, indexes of `resources`).
 * @param {Activity} activity
 * @param {object|null} [usageConfig]  The usage configuration, when known (`dnd5e.preUseActivity`).
 * @param {{recast?: boolean}} [options]
 * @returns {{keys: string[], skip: {spellSlot: boolean, resources: number[]}}}
 */
export function missingResources(activity, usageConfig=null, { recast=false }={}) {
  const none = { keys: [], skip: { spellSlot: false, resources: [] } };
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !item || !actor || recast ) return none;
  // A scroll, a spell copy cast by an object (`cachedFor`) or a linked activity (`cause`) do not spend a slot.
  const linked = !!usageConfig?.cause?.activity || !!item.getFlag?.("dnd5e", "cachedFor") || !!item.getFlag?.("dnd5e", "spellLevel");
  const spell = item.type === "spell";
  // Ritual possible (outside combat, §139): no slot needed, the ritual window decides afterwards.
  const ritual = spell && (ritualModeOf(activity) !== "none");
  const needsSlot = spell && !linked && !ritual && !!activity.requiresSpellSlot && !!activity.consumption?.spellSlot
    && (usageConfig?.consume !== false) && (usageConfig?.consume?.spellSlot !== false);
  const level = (Number(item.system.level) || 0) + (Number(usageConfig?.scaling) || 0);
  const left = needsSlot ? slotLeft(actor.system?.spells, level, usageConfig?.spell?.slot ?? null) : true;
  const targets = spentTargets(activity, usageConfig);
  const short = targets.filter(isShort);
  // Prepared: a method that is prepared (CONFIG.DND5E.spellcasting[…].prepares) requires `prepared`; an unprepared ritual of
  // a Ritual Adept goes through ritual mode.
  // A cantrip is not prepared (`awaitsPreparation`).
  const unprepared = spell && !linked && unpreparedSpell(item) && !ritual;
  // A depleted physical object (the last javelin thrown, left on the sheet at 0).
  const empty = ["weapon", "consumable", "equipment", "tool"].includes(item.type) && (item.system.quantity !== undefined)
    && (Number(item.system.quantity) <= 0);
  const keys = resourceIssues({
    slotMissing: (needsSlot && !left) || short.some(t => t.kind === "slot"),
    usesShort: short.some(t => t.kind === "uses"),
    quantityShort: empty || short.some(t => t.kind === "quantity"),
    unprepared });
  return { keys, skip: { spellSlot: needsSlot && !left, resources: short.map(t => t.index) } };
}
