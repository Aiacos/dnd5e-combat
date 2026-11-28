/**
 * Pool that absorbs damage (SPEC §16.11, B14: Arcane Ward), read and written in Foundry. The content declares
 * `absorb` on the item (core/content.mjs); the pool's HP are the item's uses (`system.uses`:
 * `value` remaining, `max` = 2 × wizard level + Int mod. in the PHB); the pool only exists once created
 * (`activeAfter`: the "create the ward" activity, one use per Long Rest, spent).
 *
 * Verified in dnd5e 6.0.3: `dnd5e.preApplyDamage(actor, amount, updates, options)` is called before the write, on the
 * client that applies (documents/actor/actor.mjs, `applyDamage`): `updates` is rewritten; `amount` = damage after
 * Resistances, before Temporary Hit Points. The ward takes the damage "in place of" the creature: before its
 * Temporary Hit Points.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { spendItemUses } from "./uses.mjs";

/** The active pools of an actor: `{ item, rule, pool }`. */
export function poolsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.absorb;
    if ( !rule ) continue;
    if ( rule.activeAfter ) {
      const creator = item.system.activities?.get(rule.activeAfter);
      if ( !(creator?.uses?.spent > 0) ) continue;   // not yet created since the last rest
    }
    const pool = Number(item.system.uses?.value) || 0;
    out.push({ item, rule, pool });
  }
  return out;
}

/**
 * §38: the active pool of ANOTHER actor, designated by its item's uuid (Projected Ward: the wizard's ward takes an ally's
 * damage), or null if it does not exist or has not been created.
 */
export function poolOfItem(uuid) {
  const item = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return item?.actor ? (poolsOf(item.actor).find(p => p.item === item) ?? null) : null;
}

/**
 * `dnd5e.preApplyDamage`: the pool absorbs what it can, the HP update is recomputed on the remainder.
 * What was absorbed is kept in `options` (the pool's spending, after the write; the 0 HP, §17).
 * `options["dnd5e-combat"].absorbInto` (§38): the item uuid of another actor's pool, which absorbs the first ("if this
 * damage reduces the ward to 0 HP, the protected creature takes the remainder"; `amount` is already after Resistances,
 * as the text requires).
 */
export function absorbDamage(actor, amount, updates, options) {
  if ( !(amount > 0) ) return;
  const hp = actor?.system?.attributes?.hp;
  if ( !hp ) return;
  let left = amount;
  const spent = [];
  const foreign = poolOfItem(options?.[MODULE_ID]?.absorbInto);
  for ( const { item, pool } of [...(foreign ? [foreign] : []), ...poolsOf(actor)] ) {
    if ( !(left > 0) || !(pool > 0) ) continue;
    const take = Math.min(pool, left);
    left -= take;
    spent.push({ item: item.uuid, name: item.name, take, before: pool });
  }
  if ( !spent.length ) return;
  const absorbed = amount - left;
  // Same calculation as `applyDamage`, on what remains: Temporary Hit Points first, then HP (clamped to 0).
  const temp = hp.temp ?? 0;
  const deltaTemp = Math.min(temp, left);
  const deltaHp = Math.min(hp.value, left - deltaTemp);
  updates["system.attributes.hp.temp"] = temp - deltaTemp;
  updates["system.attributes.hp.value"] = hp.value - deltaHp;
  options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), absorbed: (options[MODULE_ID]?.absorbed ?? 0) + absorbed, pools: spent };
}

/** `dnd5e.applyDamage`: the pool spends what it absorbed, and the chat says so. */
export async function spendPools(actor, options) {
  const pools = options?.[MODULE_ID]?.pools ?? [];
  for ( const { item: uuid, name, take, before } of pools ) {
    const item = fromUuidSync(uuid, { strict: false });
    if ( !item ) continue;
    await spendItemUses(item, take);
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: item.actor ?? actor }),   // §38: the projected ward speaks for its wizard
      content: `<p>${game.i18n.format("DND5ECOMBAT.Absorbe", { item: name, n: take, rest: Math.max(0, before - take) })}</p>`,
      flags: { [MODULE_ID]: { absorbed: { item: item.system.identifier, actor: actor.uuid, amount: take, rest: Math.max(0, before - take) } } }
    });
  }
  return pools;
}

/**
 * The pool is created (`activeAfter`: the "create the ward" activity has just been used): it starts full, as the rule
 * requires. The PHB activity returns `@item.uses.max` uses, but the compendium item arrives with 11
 * uses spent for a maximum of 5 at level 1 (seen in play on 2026-09-24): returning the maximum does not fill it.
 */
async function fillOnCreate(message, item) {
  const rule = item ? contentOf(item).entry?.absorb : null;
  const activityId = message.getAssociatedActivity?.()?.id ?? message.system?.activity?.id ?? null;
  if ( !rule?.activeAfter || (activityId !== rule.activeAfter) ) return;
  if ( (Number(item.system.uses?.spent) || 0) === 0 ) return;
  await item.update({ "system.uses.spent": 0 });
}

/**
 * A spell cast with a spell slot recharges the pools that ask for it (`recharge: { school, perLevel }`: Arcane
 * Ward: an abjuration spell recharges it by twice the slot's level). Active GM only.
 * @param {ChatMessage} message  The use message (`type: "usage"`).
 * @returns {Promise<Array<{name: string, gained: number}>>}
 */
export async function rechargePools(message) {
  const spell = message.getAssociatedItem?.();
  const actor = message.getAssociatedActor?.();
  await fillOnCreate(message, spell);
  const level = Number(message.system?.level) || 0;
  if ( !spell || !actor || (spell.type !== "spell") || (level < 1) ) return [];
  // "With a spell slot": not a cantrip, nor a ritual, nor an "at will" spell or one cast from item uses.
  const method = spell.system?.method ?? spell.system?.preparation?.mode;
  if ( method && !["spell", "prepared", "always", "pact"].includes(method) ) return [];
  const out = [];
  for ( const { item, rule } of poolsOf(actor) ) {
    const r = rule.recharge;
    if ( !r || (spell.system?.school !== r.school) ) continue;
    const spent = Number(item.system.uses?.spent) || 0;
    const gained = Math.min(spent, r.perLevel * level);
    if ( !(gained > 0) ) continue;
    await item.update({ "system.uses.spent": spent - gained });
    out.push({ name: item.name, gained });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("DND5ECOMBAT.Recharge", { item: item.name, n: gained, spell: spell.name })}</p>`,
      flags: { [MODULE_ID]: { recharged: { item: item.system.identifier, actor: actor.uuid, amount: gained } } }
    });
  }
  return out;
}
