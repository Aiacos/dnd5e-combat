/**
 * Spell defenses (SPEC §16.46), read and written in Foundry.
 *  - Resistance: when the engine applies damage (by type, before Resistances and Temporary Hit Points), the bearer of an effect
 *    from the item removes `formula` from the protected type's damage — the profile is recognized by the effect's
 *    `system.origin.profile` as applied (applications/components/effect-application.mjs:255); once per combat
 *    turn (mark on the effect).
 *  - Arcane Vigor: Hit Dice spent (`system.hd.spent` of the classes), heal cast and applied.
 */

import { MODULE_ID } from "../constants.mjs";
import { reduceDamageOfType, hitDiceAllowed, halveUnresisted } from "../core/defenses.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
// The key carries the combat id: the "once per turn" mark from a previous combat no longer counts.
import { currentTurnKey } from "./turn.mjs";

/** A worn item that protects (§65): equipped, and attuned if it requires attunement. */
function worn(item) {
  if ( !item?.system?.equipped ) return false;
  return (item.system.attunement !== "required") || !!item.system.attuned;
}

/**
 * The damage shields that the actor carries: `{ effect, type, rule }` — `effect` is the document that keeps the "once per
 * turn" mark and gives its name: the item's effect, or the worn item itself (`worn`).
 */
function shieldsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item)?.entry?.damageShield;
    if ( rule?.worn && worn(item) ) out.push({ effect: item, type: rule.worn, rule });
  }
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const rule = contentOf(originItemOf(effect))?.entry?.damageShield;
    if ( !rule?.effects ) continue;
    // The origin profile: noted by dnd5e on the applied effect (`system.origin.profile`, effect-application.mjs:255), otherwise
    // the copy's source.
    const source = String(effect._stats?.duplicateSource ?? effect._stats?.compendiumSource ?? "");
    const profile = effect.system?.origin?.profile ?? source.split(".").pop();
    const type = rule.effects[profile];
    if ( type ) out.push({ effect, type, rule });
  }
  return out;
}

/**
 * Reduces the protected type's damage, at the moment the engine applies it (adapter/messages.mjs, `applyDamageToToken`): a real
 * die roll (the V14 core does not roll a die synchronously: a 1d4 evaluated in `dnd5e.preCalculateDamage` was worth 0), only
 * once per hit (the hook also serves the chat card previews). Returns `{ damages, done: [{ name, type, reduced,
 * rolled }] }`.
 */
export async function applyDamageShields(actor, damages) {
  let out = damages;
  const done = [];
  const key = currentTurnKey();
  for ( const { effect, type, rule } of shieldsOf(actor) ) {
    if ( !out.some(d => (d.type === type) && (d.value > 0)) ) continue;
    if ( rule.oncePerTurn && key && (effect.getFlag(MODULE_ID, "shieldTurn") === key) ) continue;
    const roll = await new Roll(rule.formula).evaluate();
    const result = reduceDamageOfType(out, type, roll.total);
    if ( !result.reduced ) continue;
    out = result.damages;
    if ( rule.oncePerTurn && key ) await effect.setFlag(MODULE_ID, "shieldTurn", key).catch(() => {});
    done.push({ name: effect.name, type, reduced: result.reduced, rolled: roll.total, formula: rule.formula });
  }
  return { damages: out, done };
}

/** The Hit Dice healing rule of this activity (`hitDiceHeal`), or null. */
export function hitDiceHealOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.hitDiceHeal : null;
  return (rule && (rule.activity === activity.id)) ? rule : null;
}

/** What the actor can spend: the largest size available, how many remain, how many the rule allows. */
export function hitDiceChoice(activity, slotLevel) {
  const hd = activity.actor?.system?.attributes?.hd;
  const die = hd?.largestAvailable ?? "d0";
  const available = hd?.bySize?.[die] ?? 0;
  const rule = hitDiceHealOf(activity);
  const spellLevel = Number(activity.item.system.level) || 0;
  return { die, available, max: rule ? hitDiceAllowed({ base: rule.base, spellLevel, slotLevel, available }) : 0 };
}

/**
 * Spends `count` Hit Dice of size `die` and heals the actor by their total + the spellcasting modifier (activity data,
 * `@mod`). On the caster's client (their character). Returns the roll.
 */
export async function spendHitDiceToHeal(activity, die, count) {
  const actor = activity.actor;
  let left = count;
  for ( const cls of Object.values(actor.classes ?? {}) ) {
    if ( (cls.system.hd.denomination !== die) || (left <= 0) ) continue;
    const take = Math.min(left, cls.system.hd.value);
    if ( take > 0 ) await cls.update({ "system.hd.spent": cls.system.hd.spent + take });
    left -= take;
  }
  const spent = count - left;
  if ( !spent ) return null;
  const roll = await new CONFIG.Dice.DamageRoll(`${spent}${die} + @mod`, activity.getRollData(), { type: "healing" }).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${activity.item.name} — ${spent}${die}` });
  await actor.applyDamage([{ value: roll.total, type: "healing" }]);
  return roll;
}

/* -------------------------------------------- */
/*  O8d (§347): defenses against ranged attacks */
/* -------------------------------------------- */

/** The `rangedDefense` rules of the items the actor carries (and has attuned if needed). */
export function rangedDefensesOf(actor) {
  return Array.from(actor?.items ?? []).filter(worn).map(i => contentOf(i).entry?.rangedDefense).filter(Boolean);
}

/** AC bonus against a ranged attack roll (Arrow-Catching Shield: +2, on top of the shield's bonus). */
export function rangedAcBonus(actor) {
  return rangedDefensesOf(actor).reduce((sum, r) => sum + (Number(r.ac) || 0), 0);
}

/** Resistance to ranged weapon attack damage (Shield of Missile Attraction): the reduced damage, otherwise unchanged. */
export function resistRangedWeapon(actor, damages) {
  if ( !rangedDefensesOf(actor).some(r => r.resistance === true) ) return { damages, reduced: 0 };
  const traits = actor.system?.traits ?? {};
  return halveUnresisted(damages, { resisted: traits.dr?.value ?? [], immune: traits.di?.value ?? [] });
}

/** O9a (§354): does the actor wear adamantine armor (dnd5e `ada` property, on equipped armor)? */
export function wearsAdamantine(actor) {
  return Array.from(actor?.items ?? []).some(i => (i.type === "equipment") && i.system?.equipped && (i.system?.type?.value !== "shield")
    && (i.system?.properties?.has?.("ada") === true));
}

/**
 * O9g (§361): "Wisdom (Perception) checks made to perceive you have Disadvantage" (Cloak of Elvenkind, worn and attuned: content
 * `hardToPerceive`) — passive Perception against this bearer loses 5 (the Disadvantage rule on a passive score).
 */
export function hardToPerceive(actor) {
  return Array.from(actor?.items ?? []).some(i => worn(i) && (contentOf(i).entry?.hardToPerceive === true));
}
