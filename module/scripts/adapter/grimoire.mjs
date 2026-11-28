/**
 * §139: the Wizard's spellbook, Foundry side — what `core/grimoire.mjs` judges, read from the actor and the spell.
 *  - Ritual: the spell's `ritual` tag (`system.properties`), the activity's `requiresSpellSlot` and `consumption.spellSlot`,
 *    the spell's `system.method` / `system.prepared`; Ritual Adept = an actor item that declares `ritualAdept: { class }`.
 *  - Arcane Recovery: an item that declares `slotRecovery: { class, maxLevel }`, its uses (1 / Long Rest).
 */

import { contentOf } from "./content.mjs";
import { combatantFor } from "./turn.mjs";
import { ritualMode, recoveryUses } from "../core/grimoire.mjs";
import { spellClassOf } from "./spell-class.mjs";

/** Does the caster still have a slot (or a pact slot) of the spell's level or higher? */
export function slotLeft(item) {
  const level = item.system?.level ?? 0;
  return Object.values(item.actor?.system?.spells ?? {}).some(s => (s?.value > 0) && ((s.level ?? 0) >= level));
}

/** Does the spell come from this class's spellbook? Its origin class, or, without one, a class the actor has. */
function fromClass(item, cls) {
  const source = spellClassOf(item);
  return source ? (source === cls) : !!item.actor?.classes?.[cls];
}

/**
 * How this activity would be cast now: "none", "ritual" (as a ritual automatically) or "ask" (ritual or slot).
 * @param {Activity} activity
 * @returns {"none"|"ritual"|"ask"}
 */
export function ritualModeOf(activity) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !actor || (item?.type !== "spell") ) return "none";
  const adept = actor.items.some(i => {
    const rule = contentOf(i).entry?.ritualAdept;
    return !!rule && fromClass(item, rule.class);
  });
  return ritualMode({
    ritual: item.system.properties?.has?.("ritual") === true,
    requiresSlot: !!(activity.requiresSpellSlot && activity.consumption?.spellSlot),
    inCombat: !!combatantFor(actor),
    // Prepared: a method that is prepared (CONFIG.DND5E.spellcasting[…].prepares: "spell", "pact") requires `prepared`; the
    // others (innate, at will…) are always ready.
    prepared: !CONFIG.DND5E.spellcasting?.[item.system.method]?.prepares || !!item.system.prepared,
    adept,
    slotLeft: slotLeft(item)
  });
}

/**
 * The actor's Arcane Recovery, if it can be used: the item, its rule, the class level, the slots per level, and
 * where its use is counted (`counter`: "activity", "item" or null). null without an item, without a remaining use.
 * @param {Actor5e} actor
 */
export function slotRecoveryOf(actor) {
  // The first that can be used: a Wizard / Druid has two, each with its class and its use.
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.slotRecovery;
    if ( !rule ) continue;
    const found = recoveryOf(actor, item, rule);
    if ( found ) return found;
  }
  return null;
}

function recoveryOf(actor, item, rule) {
  const counter = recoveryUses(item.system.uses, rule.activity ? item.system.activities?.get(rule.activity)?.uses : null);
  if ( !counter.left ) return null;
  const classLevel = actor.classes?.[rule.class]?.system?.levels ?? 0;
  if ( !classLevel ) return null;
  const slots = {};
  for ( let level = 1; level <= 9; level++ ) {
    const s = actor.system.spells?.[`spell${level}`];
    if ( s?.max ) slots[level] = { value: Number(s.value) || 0, max: Number(s.max) || 0 };
  }
  return { item, rule, classLevel, slots, counter: counter.on };
}
