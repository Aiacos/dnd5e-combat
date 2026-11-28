/**
 * Activity usage limits (SPEC §16.40, `usageLimits`), read in Foundry. "Already used this turn": a mark
 * on the actor (`flags["dnd5e-combat"].usedOnTurn.<id d'activité>` = turn key), placed after the use. The key carries the combat
 * id (`currentTurnKey`): a previous combat's mark no longer counts in the same round and at the same rank.
 */

import { MODULE_ID } from "../constants.mjs";
import { usageLimitIssues, lowestSlotLevel, effectRefs } from "../core/limits.mjs";
import { resourceFeedback } from "../core/feedback.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { carriesEffectFrom, comesFromItemEffect } from "./facts.mjs";
import { combatantFor, movementOf, currentTurnKey } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";
import { lightOfActor } from "./effect-while.mjs";

/**
 * Dungeon Master's Guide 3.0.0: an activity that an enchantment adds to the weapon ("rider") gets a random id there (dnd5e,
 * `EnchantmentData`, `randomID`) and `flags.dnd5e.dependentOn` = the id of the enchantment effect. Its original id: the activity
 * of the same type and name on the item that placed the enchantment (the effect's `system.origin.activity`), when it is still
 * there (on the sheet, usually). Otherwise null.
 */
export function riderOriginId(activity) {
  const effectId = activity?.flags?.dnd5e?.dependentOn;
  const effect = effectId ? activity.item?.effects?.get?.(effectId) : null;
  const origin = effect?.system?.origin?.activity ?? null;
  if ( (typeof origin !== "string") || !origin ) return null;
  let source = null;
  try { source = fromUuidSync(origin.replace(/\.Activity\.[^.]+$/, ""), { strict: false }); } catch { source = null; }
  if ( !source || (source === activity.item) || (source.documentName !== "Item") ) return null;
  const match = source.system?.activities?.find?.(a => (a.type === activity.type) && (a.name === activity.name));
  return match?.id ?? null;
}

/**
 * The limit rule of this activity, or null — under its id, or, for an activity added by an enchantment, under its original
 * id. For the copy of a spell that a "cast" activity cast (`flags.dnd5e.cachedFor`, dnd5e activity/cast.mjs), the light
 * condition of that activity applies too: it is the copy that dnd5e uses, not the feature's activity (One with Shadows).
 * The other limits remain those of the activity used.
 */
export function usageLimitOf(activity) {
  if ( !activity?.item ) return null;
  const rules = contentOf(activity.item).entry?.usageLimits;
  const originId = (rules && !rules[activity.id]) ? riderOriginId(activity) : null;
  const own = rules?.[activity.id] ?? (originId ? (rules[originId] ?? null) : null);
  const light = castLightOf(activity.item);
  return light ? { ...(own ?? {}), light } : own;
}

/** `usageLimits.<activité>.light` of the "cast" activity that cast this spell copy, or null. */
function castLightOf(item) {
  const cached = item?.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item\.([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  const caster = m ? item.actor?.items?.get(m[1]) : null;
  return caster ? (contentOf(caster).entry?.usageLimits?.[m[2]]?.light ?? null) : null;
}

/** The remaining uses of the item with this identifier on the actor, or null if it has none. */
function remainingUses(actor, identifier) {
  const item = actor?.items?.find(i => identifierOf(i).id === identifier);
  const value = Number(item?.system?.uses?.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * §486: does the actor carry this effect? `ref`: the identifier of an item whose Active Effect is carried (Alter Self),
 * or the id of an effect (that of an activated item of the actor, or its copy placed by dnd5e's effects tray).
 */
function carriesRef(actor, ref) {
  if ( carriesEffectFrom(actor, ref) ) return true;
  return Array.from(actor?.appliedEffects ?? actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed && comesFromItemEffect(e, ref));
}

/** §486: the name to show for this effect — that of the actor's or its items' effect, else the item's, else the reference. */
function refName(actor, ref) {
  const effects = [...(actor?.effects ?? []), ...Array.from(actor?.items ?? []).flatMap(i => Array.from(i.effects ?? []))];
  const effect = effects.find(e => comesFromItemEffect(e, ref));
  if ( effect?.name ) return effect.name;
  return actor?.items?.find(i => identifierOf(i).id === ref)?.name ?? ref;
}

/**
 * What is wrong for this use (`notOwnTurn`, `oncePerTurn`, `notEmpty`, `moved`, `needsEffect`, `barredByEffect`),
 * the expected empty item and, §486, the name of the required or preventing effect.
 * @param {Activity} activity
 * @param {{inCombat: boolean, ownTurn: boolean}} turn
 */
export function usageLimitProblems(activity, { inCombat, ownTurn }) {
  const rule = usageLimitOf(activity);
  if ( !rule ) return { issues: [], item: null, effect: null };
  const key = currentTurnKey();
  const usedThisTurn = !!key && (activity.actor?.getFlag(MODULE_ID, `usedOnTurn.${activity.id}`) === key);
  const remaining = rule.whenEmpty ? remainingUses(activity.actor, rule.whenEmpty) : null;
  const item = rule.whenEmpty ? activity.actor?.items?.find(i => identifierOf(i).id === rule.whenEmpty)?.name ?? rule.whenEmpty : null;
  // §20: "if you have not moved during this turn" (Steady Aim) — the movement spent this turn, excluding teleportation.
  const combatant = (rule.unmoved && inCombat) ? combatantFor(activity.actor) : null;
  const moved = !!combatant && ((movementOf(combatant, readUnitFactors())?.spent ?? 0) > 0);
  // §486: only under an effect (one from the list), or outside those.
  const needed = effectRefs(rule.whileEffect);
  const barring = effectRefs(rule.unlessEffect);
  const underEffect = needed.length ? needed.some(r => carriesRef(activity.actor, r)) : null;
  const barredBy = barring.find(r => carriesRef(activity.actor, r)) ?? null;
  // The light where the user stands, for an activity that is allowed only in Dim Light or Darkness.
  const light = rule.light ? lightOfActor(activity.actor) : null;
  const issues = usageLimitIssues(rule, { inCombat, ownTurn, usedThisTurn, remaining, moved, underEffect,
    barredByEffect: barring.length ? !!barredBy : null, light });
  const effect = issues.includes("needsEffect") ? needed.map(r => refName(activity.actor, r)).join(" / ")
    : (barredBy ? refName(activity.actor, barredBy) : null);
  return { issues, item, effect };
}

/**
 * §16.40: `lowestSlot` — the activity spends a slot whose level is set by `scaling` ("spellSlots" consumption,
 * target level 1, scaling by level); it is fixed on the lowest available and dnd5e's window does not open.
 * Returns false if no slot is left (the use is then cancelled), true otherwise (or not applicable).
 */
export function applyLowestSlot(activity, usageConfig, dialogConfig) {
  const rule = usageLimitOf(activity);
  // `cost`: the cost of the 2024 rule ("Flames", "Druid's Staff": Bonus Action; the data say "action"), except if
  // the intention set one ("Size", controlled object command).
  if ( rule?.cost && !usageConfig[MODULE_ID]?.cost ) usageConfig[MODULE_ID] = { ...(usageConfig[MODULE_ID] ?? {}), cost: rule.cost };
  // `noDialog`: nothing to choose (spell slot recovery: everything is consumed as declared).
  if ( rule?.noDialog && dialogConfig ) dialogConfig.configure = false;
  if ( !rule?.lowestSlot ) return true;
  const spells = activity.actor?.system?.spells ?? {};
  const available = {};
  for ( let level = 1; level <= 9; level++ ) available[level] = Number(spells[`spell${level}`]?.value) || 0;
  const level = lowestSlotLevel(available);
  if ( level === null ) return false;
  const base = Number(activity.consumption?.targets?.find(t => t.type === "spellSlots")?.target) || 1;
  usageConfig.scaling = Math.max(0, level - base);
  if ( dialogConfig ) dialogConfig.configure = false;
  return true;
}

/**
 * §16.40: what a use card returned or spent (consumptions of its activity, at the level cast), for the feedback
 * above the token (ui/feedback.mjs). Empty for an activity that returns nothing.
 * @param {ChatMessage} message
 */
export function resourceChangesOf(message) {
  const activity = message?.getAssociatedActivity?.();
  if ( !activity?.consumption?.targets?.length ) return [];
  const actor = activity.actor;
  const scaling = Number(message.system?.scaling) || 0;
  const itemFor = target => {
    if ( !target ) return activity.item;
    return actor?.items?.get(target) ?? actor?.items?.find(i => (i._stats?.compendiumSource === target) || (identifierOf(i).id === target)) ?? null;
  };
  const targets = activity.consumption.targets.map(t => {
    const value = Number(t.value);
    if ( t.type === "itemUses" ) return { type: t.type, value, name: itemFor(t.target)?.name ?? "" };
    if ( t.type === "spellSlots" ) {
      const base = Number(t.target) || 1;
      return { type: t.type, value, level: base + ((t.scaling?.mode === "level") ? scaling : 0) };
    }
    return { type: t.type, value };
  });
  return resourceFeedback(targets);
}

/** After the use: the "used this turn" mark (on the user's client, which owns the actor). */
export async function markUsedThisTurn(activity) {
  const rule = usageLimitOf(activity);
  const key = currentTurnKey();
  if ( !rule?.oncePerTurn || !key || !activity.actor?.isOwner ) return false;
  await activity.actor.setFlag(MODULE_ID, `usedOnTurn.${activity.id}`, key);
  return true;
}
