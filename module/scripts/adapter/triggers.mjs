/**
 * The trigger registry as seen from dnd5e 6.0: what an actor's items declare,
 * all content layers combined (adapter/content.mjs), in canonical form and with their
 * provenance. The facts are in adapter/facts.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { normalize, select, stepsOf, holds } from "../core/triggers.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { unpreparedSpell } from "./resources.mjs";
import { originItemOf, factsFor, comesFromItemEffect, weaponKind, swornEnemyOf, tokenOf } from "./facts.mjs";
import { hasReactionAdvantage, takeReactionAdvantage, hasReactionDisadvantage, takeReactionDisadvantage } from "./marks.mjs";
import { markModifiers } from "./mastery.mjs";
import { exclusiveWeaponHindrances } from "../core/attack.mjs";
import { isVanilla } from "./vanilla-state.mjs";
import { shownActivityOf, usesHolderOf } from "./uses.mjs";
import { tidyDice } from "../core/formula-tidy.mjs";
export { factsFor, originItemOf, tokenOf, comesFromItemEffect } from "./facts.mjs";

/**
 * What an item declares. Each declaration knows where it comes from (item, Reaction activity).
 * `via: "effect"` declarations do not concern the item's bearer but the creatures that carry
 * an effect of the item (declarationsOfEffects): `all` returns them anyway, for validation.
 */
export function declarationsOfItem(item, { all=false }={}) {
  const list = contentOf(item).entry?.triggers ?? [];
  if ( !list.length ) return [];
  const activities = Array.from(item.system?.activities ?? []);
  const reaction = activities.find(a => a.activation?.type === "reaction") ?? activities[0];
  return list.map(d => normalize(d, {
    item: item.uuid, name: item.name, img: item.img,
    identifier: identifierOf(item).id,
    activity: reaction?.uuid ?? null
  })).filter(d => all || (d.via === null));
}

/**
 * O6 (§342): a piece of equipment (ring, cloak, wondrous item, armor, shield) declares nothing if it is not worn, or not attuned
 * when it requires it — the "Ring of Total Dodge" in the bag does not offer its Reaction. Weapons, features and spells: unchanged.
 */
export function wornOrNotEquipment(item) {
  if ( item?.type !== "equipment" ) return true;
  if ( item.system?.equipped === false ) return false;
  return (item.system?.attunement !== "required") || (item.system?.attuned === true);
}

/**
 * §484: the actor's items whose `rollDisadvantage` hits this roll (`kind`: "check" or "save") — the condition looks at the actor
 * itself (`self.*`: in sunlight, in Bright Light, in running water). Returns their names.
 * @param {Actor} actor
 * @param {"check"|"save"} kind
 * @param {TokenDocument|null} [token]
 * @returns {string[]}
 */
export function declaredRollDisadvantage(actor, kind, token=null) {
  return declaredRollMode(actor, kind, token, "rollDisadvantage");
}

/** The counterpart, for Advantage (`rollAdvantage`: Bloodied Frenzy, "while Bloodied, Advantage on saving throws"). */
export function declaredRollAdvantage(actor, kind, token=null) {
  return declaredRollMode(actor, kind, token, "rollAdvantage");
}

function declaredRollMode(actor, kind, token, key) {
  const out = [];
  let facts = null;
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.[key];
    if ( !rule?.on?.includes?.(kind) || !wornOrNotEquipment(item) ) continue;
    facts ??= factsFor({ self: actor, selfToken: tokenOf(actor, token) });
    if ( holds(rule.if ?? null, facts) ) out.push(item.name);
  }
  return out;
}

/**
 * Issue #145: a spell waiting to be prepared declares nothing — an unprepared Shield does not offer its Reaction. The same rule
 * as at casting (adapter/resources.mjs, `unpreparedSpell`); the copy of a spell that an object casts (`cachedFor`) is not
 * concerned.
 */
export function preparedOrNotSpell(item) {
  return !unpreparedSpell(item) || !!item.getFlag?.("dnd5e", "cachedFor");
}

/** What all of an actor's items declare (for itself). */
export function declarationsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( wornOrNotEquipment(item) && preparedOrNotSpell(item) ) out.push(...declarationsOfItem(item));
  }
  return out;
}


/**
 * What the effects carried by an actor declare (SPEC §16, "repeated save" brick): the
 * `via: "effect"` declarations of the item each Active Effect comes from, with the effect and the activity that
 * applied it (`system.origin.activity`, dnd5e 6's effects tray).
 */
export function declarationsOfEffects(actor) {
  const out = [];
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    // §395: an effect applied by an action cast without DAS stays dnd5e's business until it ends.
    if ( isVanilla(effect) ) continue;
    // The caster's CONCENTRATION effect comes from the same item: it does not carry the target's rule. Seen in play on
    // 2026-09-24: the Wizard "replayed" the Hold Person save at the end of its turn, succeeded, and its Concentration dropped —
    // along with the Zombie's Paralyzed.
    if ( effect.statuses?.has?.("concentrating") || (effect.getFlag?.("dnd5e", "type") === "concentration") ) continue;
    const item = originItemOf(effect);
    if ( !item ) continue;
    for ( const d of declarationsOfItem(item, { all: true }) ) {
      if ( d.via !== "effect" ) continue;
      if ( d.fromEffect && !comesFromItemEffect(effect, d.fromEffect) ) continue;
      out.push({ ...d, effect: effect.uuid, activity: effect.system?.origin?.activity ?? d.activity, source: item.actor?.uuid ?? null });
    }
  }
  return out;
}

/**
 * The marks that an attack roll consumes (SPEC §16.12, B10): among the effects carried by the target and the attacker,
 * those whose `preAttackRoll` declaration holds for this roll and carries a `consume` step on the right side — `target`
 * for a mark on the target (Guiding Bolt), `source` for a mark on the attacker (Vicious Mockery).
 * @returns {Array<{effect: string, name: string, side: "target"|"source", bearer: string}>}  Uuids of the effects to remove.
 */
export function consumedMarks(sourceToken, targetToken, activity) {
  const source = sourceToken?.actor ?? null;
  const target = targetToken?.actor ?? null;
  if ( !source || !target ) return [];
  const facts = factsFor({ source, target, activity, sourceToken, targetToken });
  const out = [];
  for ( const [side, bearer] of [["target", target], ["source", source]] ) {
    for ( const d of select(declarationsOfEffects(bearer), "preAttackRoll", facts) ) {
      if ( !stepsOf(d, "consume").some(s => s.side === side) ) continue;
      if ( !out.some(o => o.effect === d.effect) ) out.push({ effect: d.effect, name: d.name, side, bearer: bearer.name });
    }
  }
  return out;
}

/**
 * Advantage and Disadvantage that the content declares for ONE attack (SPEC §16, B6: `preAttackRoll` moment):
 * the attacker's items (Pack Tactics), and the effects carried by the attacker as well as by the target
 * (`via: "effect"`: Faerie Fire on the target, Protection from Evil and Good on the target) — the
 * condition of each declaration says which side it looks at (`target.hasEffect`, `source.hasEffect`).
 * By item name, without duplicates; it is `attackModifiers` (core/conditions.mjs) that turns them into reasons.
 * @param {TokenDocument} sourceToken
 * @param {TokenDocument} targetToken
 * @param {Activity} activity
 * @returns {{advantage: string[], disadvantage: string[]}}
 */
/**
 * §16.46: the formulas that the declarations add to the attack roll (`attackBonus`: "Defensive Veil", "-1d4"), with the name
 * of what grants them.
 * @returns {Array<{name: string, formula: string}>}
 */
export function declaredAttackBonuses(sourceToken, targetToken, activity) {
  const source = sourceToken?.actor ?? null;
  const target = targetToken?.actor ?? null;
  if ( !source || !target ) return [];
  const declarations = [...declarationsOf(source), ...declarationsOfEffects(source), ...declarationsOfEffects(target)];
  const facts = factsFor({ source, target, activity, sourceToken, targetToken });
  const out = [];
  for ( const d of select(declarations, "preAttackRoll", facts) ) {
    for ( const step of stepsOf(d, "attackBonus") ) out.push({ name: d.name, formula: step.formula });
  }
  return out;
}

export function declaredAttackModifiers(sourceToken, targetToken, activity) {
  const source = sourceToken?.actor ?? null;
  const target = targetToken?.actor ?? null;
  const out = { advantage: [], disadvantage: [] };
  if ( !source || !target ) return out;
  // §334: and the `defends` declarations of the target's items (Displacer Beast's Displacement: Disadvantage against it).
  const declarations = [...declarationsOf(source).filter(d => d.defends !== true), ...declarationsOfEffects(source), ...declarationsOfEffects(target),
    ...declarationsOf(target).filter(d => d.defends === true)];
  const facts = factsFor({ source, target, activity, sourceToken, targetToken });
  for ( const d of select(declarations, "preAttackRoll", facts) ) {
    for ( const type of ["advantage", "disadvantage"] ) {
      if ( stepsOf(d, type).length && !out[type].includes(d.name) ) out[type].push(d.name);
    }
  }
  // §19.6: a Reaction played "with Advantage" (Riposte), marked on this client just before its roll.
  const promised = activity?.uuid && hasReactionAdvantage(activity.uuid) ? takeReactionAdvantage(activity.uuid) : null;
  if ( promised && !out.advantage.includes(promised) ) out.advantage.push(promised);
  // §134: an Opportunity Attack against a bearer of "Rapide", marked just before its roll.
  const hamper = activity?.uuid && hasReactionDisadvantage(activity.uuid) ? takeReactionDisadvantage(activity.uuid) : null;
  if ( hamper && !out.disadvantage.includes(hamper) ) out.disadvantage.push(hamper);
  // §132: the Critical Hit marks (Crusher: Advantage against the marked creature; Slasher: Disadvantage on its attacks).
  for ( const e of target.effects ?? [] ) if ( (e.getFlag?.(MODULE_ID, "critMark")?.side === "against") && !out.advantage.includes(e.name) ) out.advantage.push(e.name);
  for ( const e of source.effects ?? [] ) if ( (e.getFlag?.(MODULE_ID, "critMark")?.side === "by") && !out.disadvantage.includes(e.name) ) out.disadvantage.push(e.name);
  // C12-e: Multiattack Defense — the attacker that hit this bearer during this turn.
  for ( const e of source.effects ?? [] ) if ( (e.getFlag?.(MODULE_ID, "hitDefense")?.against === target.uuid) && !out.disadvantage.includes(e.name) ) out.disadvantage.push(e.name);
  // §353: Advantage against the favored enemy (Oathbow).
  const sworn = swornEnemyOf(activity, targetToken);
  if ( sworn && !out.advantage.includes(sworn) ) out.advantage.push(sworn);
  // O8e (§348): Disadvantage with other weapons (Berserker Axe, Oathbow).
  for ( const name of exclusiveWeaponHindrances(exclusiveRules(sourceToken), weaponAttackItem(activity)) ) {
    if ( !out.disadvantage.includes(name) ) out.disadvantage.push(name);
  }
  // §21: the marks of weapon mastery properties — Sap (the attacker's Disadvantage), Vex (Advantage against this target).
  const marks = markModifiers(sourceToken, targetToken, activity);
  for ( const type of ["advantage", "disadvantage"] ) for ( const name of marks[type] ) if ( !out[type].includes(name) ) out[type].push(name);
  return out;
}

/** O8e (§348): the id of the weapon of a weapon attack (not an Unarmed Strike), or null. */
function weaponAttackItem(activity) {
  if ( (activity?.type !== "attack") || (activity.item?.type !== "weapon") || (weaponKind(activity) === "unarmed") ) return null;
  return activity.item.id;
}

/**
 * O8e (§348): the `exclusiveWeapon` rules of the attacker's attuned weapons — always active, or as long as a living creature
 * in the scene carries the `whileEffect` effect from this weapon (the favored enemy of the Oathbow).
 */
function exclusiveRules(sourceToken) {
  const actor = sourceToken?.actor;
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.exclusiveWeapon;
    if ( !rule || ((item.system?.attunement === "required") && (item.system?.attuned !== true)) ) continue;
    const active = (rule === true) || (sourceToken.parent?.tokens ?? []).some(t => t.actor && (t.actor !== actor)
      && ((t.actor.system?.attributes?.hp?.value ?? 1) > 0) && !t.actor.statuses?.has?.("dead")
      && t.actor.effects.some(e => !e.disabled && comesFromItemEffect(e, rule.whileEffect) && (originItemOf(e) === item)));
    out.push({ item: item.id, name: item.name, active });
  }
  return out;
}

/* -------------------------------------------- */
/*  Bonus damage: once per turn, by choice       */
/* -------------------------------------------- */

/** The combat turn of a "once per turn" part (§19.9: any turn, in combat), or null outside combat. */
export function bonusTurnKey() {
  return game.combat?.started ? `${game.combat.id}:${game.combat.round}:${game.combat.turn}` : null;
}

/** Has this "once per turn" part (`once`: the declaration's identifier) already been used this turn? */
export function bonusSpent(actor, once) {
  const turn = bonusTurnKey();
  return !!once && !!turn && (actor?.getFlag(MODULE_ID, `oncePerTurn.${once}`) === turn);
}

/** The key of a bonus damage declaration: what marks it "once per turn" and what the author accepts (`ask`). */
export const bonusKeyOf = d => d.identifier ?? d.name;

/**
 * §223 (#12): the `preDamageRoll` bonus damage that the author chooses to add or not to this hit (`ask`, Dreadful Strike) —
 * those whose condition holds against this target, not yet taken this turn, and whose activity that keeps the count still has a
 * use. Without a target, none.
 * @returns {Array<{key: string, name: string, formula: string, damageType: string|null, uses: Activity|null, left: number}>}
 */
export function optionalBonusesFor({ actor, activity, sourceToken, targetToken }) {
  if ( !actor || !targetToken?.actor ) return [];
  const facts = factsFor({ actor, source: actor, target: targetToken.actor, activity, sourceToken, targetToken });
  const out = [];
  for ( const d of select(declarationsOf(actor), "preDamageRoll", facts) ) {
    if ( !d.ask || ((d.oncePerTurn === true) && bonusSpent(actor, bonusKeyOf(d))) ) continue;
    const item = fromUuidSync(d.item ?? "", { strict: false });
    // §438: the activity visible at this level, and what keeps its count (its uses, or the item's: Manual 3.0.0).
    const uses = (d.ask.uses && item) ? shownActivityOf(item, d.ask.uses) : null;
    const left = uses ? (usesHolderOf(uses)?.left ?? 0) : Infinity;
    if ( d.ask.uses && (!uses || !(left > 0)) ) continue;
    const formula = stepsOf(d, "damage").map(s => {
      try { return tidyDice(Roll.replaceFormulaData(s.formula, (item ?? activity.item)?.getRollData?.() ?? {}, { missing: "0" })); } catch { return s.formula; }
    }).join(" + ");
    const damageType = [stepsOf(d, "damage")[0]?.damageType].flat()[0] ?? null;
    out.push({ key: bonusKeyOf(d), name: d.name, formula, damageType, uses, left });
  }
  return out;
}
