/**
 * Species traits of the 2024 Player's Handbook (SPEC §31) that touch HP: Relentless Endurance (Orc, content `endurance`) — "if you
 * are reduced to 0 Hit Points but not killed outright, you can drop to 1 Hit Point instead; once per Long
 * Rest" (the item's uses).
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { spendItemUses } from "./uses.mjs";
import { placeItemEffect } from "./effects.mjs";

/**
 * §135: "Recovery Boon", "Last Stand" — "when you would drop to 0 HP, you can drop to 1 HP instead and regain
 * as many HP as half your maximum; once per Long Rest" (the activity's uses, `lastStandHeal`). Played
 * automatically, like Relentless Endurance. Returns the item, or null.
 */
function lastStandAtZero(actor, updates) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.lastStandHeal;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity ) continue;
    const max = Number(activity.uses?.max) || 0;
    const spent = Number(activity.uses?.spent) || 0;
    if ( max && !(spent < max) ) continue;
    const hpMax = actor.system.attributes.hp.max ?? 1;
    updates["system.attributes.hp.value"] = Math.min(hpMax, 1 + Math.floor(hpMax / 2));
    if ( max ) item.update({ [`system.activities.${activity.id}.uses.spent`]: spent + 1 })
      .catch(err => console.warn(`${MODULE_ID} | ${item.name}: use not spent`, err));
    return item;
  }
  return null;
}

/** L'item d'Acharnement de l'acteur, s'il lui reste une utilisation ; sinon null. */
export function enduranceOf(actor) {
  const item = (actor?.items ?? []).find(i => !!contentOf(i).entry?.endurance);
  if ( !item ) return null;
  const uses = item.system.uses ?? {};
  const left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
  return (left > 0) ? item : null;
}

/**
 * `dnd5e.preApplyDamage`, before the death save failures at 0 HP are computed: damage that drops the creature to 0 HP
 * without killing it outright (the remainder of the damage beyond 0 is less than its HP maximum) leaves it at 1 HP; the use
 * is spent. Returns the item used, or null. `through`: the damage that passes through Temporary Hit Points.
 */
export function endureAtZero(actor, through, updates) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !(hp.value > 0) || (through < hp.value) ) return null;
  if ( (through - hp.value) >= (hp.max ?? Infinity) ) return null;   // killed outright
  const item = enduranceOf(actor);
  if ( !item ) return lastStandAtZero(actor, updates);
  updates["system.attributes.hp.value"] = 1;
  spendItemUses(item)
    .catch(err => console.warn(`${MODULE_ID} | ${item.name}: use not spent`, err));
  const rule = contentOf(item).entry?.endurance;
  if ( rule && (typeof rule === "object") ) afterEndurance(actor, item, rule, hp, updates);
  return item;
}

/**
 * §371: what follows being held at 1 HP (Fighting Spirit: "Temporary Hit Points equal to half your maximum, your points regained,
 * Resistance for one minute") — Temporary Hit Points in the same update as the HP, if they exceed those that remain; the item's
 * effect and the uses returned afterwards.
 */
function afterEndurance(actor, item, { effect, tempHp, restores }, hp, updates) {
  if ( tempHp ) {
    let amount = 0;
    try { amount = Math.floor(Roll.safeEval(Roll.replaceFormulaData(tempHp, actor.getRollData(), { missing: "0" }))) || 0; }
    catch(err) { console.warn(`${MODULE_ID} | ${item.name}: temporary HP formula « ${tempHp} »`, err); }
    const left = Number(updates["system.attributes.hp.temp"] ?? hp.temp) || 0;
    if ( amount > left ) updates["system.attributes.hp.temp"] = amount;
  }
  if ( effect ) placeItemEffect(item, effect, actor)
    .catch(err => console.warn(`${MODULE_ID} | ${item.name}: effect not placed`, err));
  const wanted = new Set(restores ?? []);
  const refills = (actor.items ?? []).filter(i => wanted.has(identifierOf(i).id) && (Number(i.system.uses?.spent) > 0))
    .map(i => ({ _id: i.id, "system.uses.spent": 0 }));
  if ( refills.length ) actor.updateEmbeddedDocuments("Item", refills)
    .catch(err => console.warn(`${MODULE_ID} | ${item.name}: uses not restored`, err));
}
