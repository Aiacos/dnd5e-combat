/**
 * §53: potions (consumables `type.value === "potion"`, Dungeon Master's Guide and Player's Handbook).
 *
 * A potion "gives the effect of a spell" through a "cast" activity: dnd5e creates a copy of the spell on the actor, marked
 * `flags.dnd5e.cachedFor` (relative uuid of the casting activity, activity/cast.mjs), then uses it. Drinking is not casting
 * a spell: no Counterspell, no rage, no verbal component, no concentration ("no Concentration required", Dungeon Master's Guide) —
 * and the effect is for the drinker.
 *
 * The potion is most often destroyed when drunk (spending its single use) BEFORE the spell copy is created:
 * it cannot be read again afterwards. Hence the mark set on the copy when it is created (`flags.dnd5e-combat.fromPotion`), from
 * the casting noted while the potion still existed (`notePotionCast`, at the `dnd5e.preUseActivity` of its "cast" activity).
 */

import { MODULE_ID } from "../constants.mjs";
import { foldRiderStatuses } from "../core/effect-riders.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";

/** Is it a potion? */
export const isPotion = item => (item?.type === "consumable") && (item.system?.type?.value === "potion");

/** "itemId.activityId" of a `cachedFor`, or null. */
function castKey(cachedFor) {
  const m = (typeof cachedFor === "string") ? cachedFor.match(/Item.([A-Za-z0-9]{16}).Activity.([A-Za-z0-9]{16})$/) : null;
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Potion castings in progress: key → { identifier, name } of the potion. */
const pending = new Map();

/** A potion's "cast" activity is about to be used: the potion is remembered, the spell copy will appear after its destruction. */
export function notePotionCast(activity) {
  if ( (activity?.type !== "cast") || !isPotion(activity.item) ) return false;
  pending.set(`${activity.item.id}.${activity.id}`, { identifier: identifierOf(activity.item).id, name: activity.item.name });
  return true;
}

/** `preCreateItem` of a spell copy: if it comes from a noted potion, it carries its mark. */
export function stampCachedSpell(item, data) {
  const from = pending.get(castKey(data?.flags?.dnd5e?.cachedFor ?? item?.flags?.dnd5e?.cachedFor));
  if ( !from ) return false;
  item.updateSource({ [`flags.${MODULE_ID}.fromPotion`]: from });
  return true;
}

/**
 * The potion that cast this spell copy — `{ identifier, name }` (the mark, or the potion still on the sheet) —, or null.
 */
export function potionOfCast(item) {
  const stamped = item?.flags?.[MODULE_ID]?.fromPotion;
  if ( stamped ) return stamped;
  const key = castKey(item?.flags?.dnd5e?.cachedFor);
  if ( !key ) return null;
  const source = item.actor?.items?.get(key.split(".")[0]) ?? null;
  if ( isPotion(source) ) return { identifier: identifierOf(source).id, name: source.name };
  return pending.get(key) ?? null;
}

/**
 * `preCreateActiveEffect`: an item effect that the content completes (`effectChanges` — Fly, Climb: "a flying / climbing speed
 * equal to your Speed", which the Guide's data do not give). `@walk`: the bearer's ground speed, read when applied.
 * Returns the number of changes added.
 */
/**
 * §96: an item effect to which the content adds conditions (`effectStatuses` — Cowardly Spirit: "Frightened" without the
 * condition in the data). Returns the number of conditions added.
 */
export function completeEffectStatuses(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return 0;
  const rules = contentOf(originItemOf(effect)).entry?.effectStatuses;
  const key = rules ? Object.keys(rules).find(id => comesFromItemEffect(effect, id)) : null;
  if ( !key ) return 0;
  const current = Array.from(effect._source.statuses ?? []);
  // §334: `{ set }` replaces the data's conditions.
  if ( Array.isArray(rules[key]?.set) ) {
    effect.updateSource({ statuses: [...rules[key].set] });
    return rules[key].set.length;
  }
  const added = rules[key].filter(s => !current.includes(s));
  if ( added.length ) effect.updateSource({ statuses: [...current, ...added] });
  return added.length;
}

/**
 * §526 (issue #255): an item effect applied to a creature — the conditions it asks for as riders become its own conditions
 * (core/effect-riders.mjs), to end with it; Prone stays apart. Returns the conditions taken over.
 */
export function foldEffectRiders(effect) {
  if ( (effect.parent?.documentName !== "Actor") || effect.transfer || !originItemOf(effect) ) return [];
  const src = effect._source;
  const riders = src.system?.rider?.statuses ?? src.flags?.dnd5e?.riders?.statuses ?? [];
  if ( !riders.length ) return [];
  const conditions = Object.keys(CONFIG.DND5E?.conditionTypes ?? {});
  const implied = Object.fromEntries(riders.map(r => [r, CONFIG.statusEffects?.find?.(e => e.id === r)?.statuses ?? []]));
  const out = foldRiderStatuses({ statuses: Array.from(src.statuses ?? []), riders, conditions, implied });
  if ( !out.folded.length ) return [];
  effect.updateSource({ statuses: out.statuses, "system.rider.statuses": out.riders,
    ...(src.flags?.dnd5e?.riders?.statuses ? { "flags.dnd5e.riders.statuses": out.riders } : {}) });
  return out.folded;
}

export function completeEffectChanges(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return 0;
  const rules = contentOf(originItemOf(effect)).entry?.effectChanges;
  const key = rules ? Object.keys(rules).find(id => comesFromItemEffect(effect, id)) : null;
  if ( !key ) return 0;
  const walk = actor.system?.attributes?.movement?.walk ?? 0;
  // §195: `replace` first removes the change with the same key the effect already carries (Spider Climb: no Speed in its formula).
  const replaced = new Set(rules[key].filter(c => c.replace).map(c => c.key));
  const current = (effect._source.system?.changes ?? []).filter(x => !replaced.has(x.key));
  // C12-e: `ifCaster` — a change that only a caster with a given ability gives (Arcane Hex).
  const caster = originItemOf(effect)?.actor ?? null;
  const owns = id => !!caster?.items?.some?.(i => identifierOf(i).id === id);
  // §433: `unlessKey` — a change the data already carries under another key ("Hamstrung" of the dnd5e 6.1 SRD: `movement.bonus`).
  const added = rules[key].filter(c => !current.some(x => (x.key === c.key) || (c.unlessKey && (x.key === c.unlessKey))) && (!c.ifCaster || owns(c.ifCaster)))
    .map(c => ({ key: c.key, type: c.type, value: String(c.value === "@walk" ? walk : c.value) }));
  if ( added.length ) effect.updateSource({ "system.changes": [...current, ...added] });
  return added.length;
}

/* -------------------------------------------- */
/*  Issue #31 : action Bonus ou action           */
/* -------------------------------------------- */

/**
 * Issue #31: does the activity offer the choice Bonus Action / action? A potion (`isPotion`) whose activity is a heal that costs
 * a Bonus Action (2024 data). An older copy that already costs an action (2014 rule) is not concerned.
 * @param {Activity} activity
 * @returns {boolean}
 */
export function offersPotionChoice(activity) {
  return !!activity && (activity.type === "heal") && isPotion(activity.item) && (activity.activation?.type === "bonus");
}

/** A potion's heal activity that offers the choice (the first one), or null. */
export function potionChoiceActivity(item) {
  if ( !isPotion(item) ) return null;
  return Array.from(item.system?.activities ?? []).find(a => offersPotionChoice(a)) ?? null;
}

/** A healing potion to be drunk (menu): a potion with a heal activity, whatever its cost. */
export function healingPotionActivity(item) {
  if ( !isPotion(item) || !((item.system?.quantity ?? 1) > 0) ) return null;
  return Array.from(item.system?.activities ?? []).find(a => a.type === "heal") ?? null;
}

/**
 * An activity's heal formulas, and their maximum ("do not roll the dice"): `{ formula, max }` or null if the data have none.
 * `maximize`: the pure function that sets the dice to their maximum (core/max-dice.mjs).
 */
export function healingFormulaOf(activity, maximize) {
  try {
    const config = activity.getDamageConfig({});
    const rolls = (config.rolls ?? []).filter(r => r.parts?.length);
    if ( !rolls.length ) return null;
    const data = rolls[0].data ?? activity.getRollData();
    const parts = rolls.map(r => r.parts.join(" + "));
    const formula = parts.join(" + ");
    const shown = new Roll(formula, data);
    const max = new Roll(maximize(formula), data).evaluateSync({ strict: false }).total;
    return { formula: shown.formula, max: Number.isFinite(max) ? max : null };
  } catch { return null; }
}
