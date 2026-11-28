/**
 * §211: Ready — what an actor can ready, the slots of a readied spell, and the Reaction option that releases the plan.
 *
 * Verified (dnd5e 6.0, `references/dnd5e-6/src`):
 *  - a readied spell is cast on its turn: the slot is spent and the creature concentrates on it until it is released
 *    (`Actor5e#beginConcentrating(activity)`, documents/actor/actor.mjs:1091);
 *  - on release, `use({ consume: { spellSlot: false }, spell: { slot } })` (documents/activity/mixin.mjs:445-497) casts the spell
 *    without taking a slot again, at the level of the one spent.
 */

import { MODULE_ID } from "../constants.mjs";
import { readyReach } from "../core/ready.mjs";

/** Is the spell ready to be cast (cantrip, prepared, pact, innate, at will)? */
function castable(item) {
  return ((item.system.level ?? 0) === 0) || !!item.system.prepared || ["pact", "innate", "atwill", "always"].includes(item.system.method);
}

/** An activity's range data, for `readyReach`. */
function reachData(activity) {
  const item = activity.item;
  const melee = (activity.type === "attack") && (activity.attack?.type?.value === "melee");
  return readyReach({
    melee,
    reach: activity.range?.reach ?? item.system.range?.reach ?? 5,
    range: { value: activity.range?.value ?? item.system.range?.value ?? null, units: activity.range?.units ?? item.system.range?.units ?? "ft" },
    template: { size: activity.target?.template?.size ?? null, units: activity.target?.template?.units ?? "ft" }
  });
}

/**
 * What an actor can ready: the attacks of their weapons (equipped for a character) and of their features, and the ready spells that
 * are cast with an action ("a spell whose casting time is one action"). One option per activity that acts.
 * @returns {Array<{activity: string, name: string, img: string, level: number, spell: boolean,
 *   reach: {value: number, units: string}|null}>}
 */
export function readyOptionsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const spell = item.type === "spell";
    if ( spell ) {
      if ( !castable(item) || ((item.system.activation?.type ?? "action") !== "action") ) continue;
    } else if ( item.type === "weapon" ) {
      if ( (actor.type === "character") && !item.system.equipped ) continue;
    } else if ( item.type !== "feat" ) continue;
    const activities = [...(item.system.activities ?? [])].filter(a => spell
      ? ["attack", "save", "damage", "heal", "utility", "summon"].includes(a.type) : (a.type === "attack"));
    for ( const activity of activities ) {
      if ( !spell && !["weapon", "unarmed"].includes(activity.attack?.type?.classification) && (item.type === "feat") ) continue;
      const many = activities.length > 1;
      out.push({ activity: activity.uuid, name: many && activity.name ? `${item.name} : ${activity.name}` : item.name, img: item.img,
        level: spell ? (item.system.level ?? 0) : 0, spell, reach: reachData(activity) });
    }
  }
  return out;
}

/** The slots from which to cast a spell of this level (at least its own, non-empty), from lowest to highest. */
export function slotsFor(actor, level) {
  const out = [];
  for ( const [key, v] of Object.entries(actor?.system?.spells ?? {}) ) {
    const lvl = (key === "pact") ? Number(v?.level) : Number(key.replace("spell", ""));
    if ( Number.isFinite(lvl) && (lvl >= level) && ((Number(v?.value) || 0) > 0) && ((Number(v?.max) || 0) > 0) ) out.push({ key, level: lvl, value: Number(v.value) });
  }
  return out.sort((a, b) => a.level - b.level);
}

/** Spends the chosen slot (readied spell: the energy is held until the trigger). */
export async function spendSlot(actor, key) {
  const value = Number(actor?.system?.spells?.[key]?.value) || 0;
  if ( value < 1 ) return false;
  await actor.update({ [`system.spells.${key}.value`]: value - 1 });
  return true;
}

/** The concentration effect that holds a readied spell (set by `holdSpell`), or null. */
export function heldEffectOf(actor) {
  return (actor?.effects ?? []).find(e => e.getFlag?.(MODULE_ID, "readied")) ?? null;
}

/**
 * Holds the readied spell through Concentration: the concentration in progress ends (one concentrates on only one thing), then a
 * concentration effect in dnd5e's format is set, marked (`ActiveEffect5e.createConcentrationEffectData`,
 * documents/active-effect.mjs:921 — which cannot be called here: it refuses a spell without Concentration, yet it is the Ready
 * action's rule that imposes it). It lasts until the start of the next turn (runtime/ready.mjs removes it); dnd5e counts it
 * (`Actor5e#concentration`, the `concentrating` condition): damage calls for the Constitution roll. Returns the effect, or null.
 */
export async function holdSpell(activity) {
  const actor = activity?.actor;
  const item = activity?.item;
  if ( !actor || !item?.isEmbedded ) return null;
  if ( actor.concentration?.effects?.size ) await actor.endConcentration();
  const status = CONFIG.statusEffects[CONFIG.specialStatusEffects.CONCENTRATING];
  const data = {
    ...status,
    name: `${game.i18n.localize("EFFECT.DND5E.StatusConcentrating")}: ${item.name}`,
    origin: item.uuid,
    statuses: [status.id].concat(status.statuses ?? []),
    system: { type: "concentrating" },
    flags: {
      dnd5e: { activity: { type: activity.type, id: activity.id, uuid: activity.uuid }, item: { type: item.type, id: item.id, uuid: item.uuid },
        spellLevel: item.system.level },
      [MODULE_ID]: { readied: true }
    }
  };
  delete data.id;
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return effect ?? null;
}

/**
 * The Reaction option that releases the plan, in `askReaction`'s format: its activity, against the creature that triggered; a
 * readied spell is cast without a slot, at the level spent, and its concentration effect falls first; the card carries
 * `readiedRelease` (the plan is served: runtime/turn.mjs removes it from the budget with the Reaction).
 */
export function readyOption(plan) {
  return {
    activity: plan.activity, name: plan.name, img: plan.img, consume: true, ready: true,
    usage: plan.slot ? { consume: { spellSlot: false }, spell: { slot: plan.slot } } : null,
    drop: plan.held ? [plan.held] : [],
    flags: { readiedRelease: true },
    template: true
  };
}
