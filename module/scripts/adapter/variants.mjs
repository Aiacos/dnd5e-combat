/**
 * M5 (SPEC §18.8): an item's attack variants as seen from Foundry — original English names of the activities (Babele keeps them
 * in `flags.babele.originalPayload.activities[<id>].name`), attacker and target facts, charge read from
 * the turn's movement history that the V14 core keeps (`TokenDocument#movementHistory`, cleared at the start of the turn).
 */

import { variantsOf, chooseVariant, advantageVariant, straightChargeFeet } from "../core/variants.mjs";
import { sizeLimitIn } from "../core/riders.mjs";
import { englishDescription } from "./multiattack.mjs";
import { originItemOf } from "./facts.mjs";
import { committedPosition } from "./turn.mjs";
import { lengthIn } from "./units.mjs";

/** The English name of an activity: the pre-Babele one, otherwise its own. */
function englishName(item, activity) {
  return item?.flags?.babele?.originalPayload?.activities?.[activity.id]?.name ?? activity.name ?? "";
}

/** An item's attack variants, or null. */
export function variantPlanOf(item) {
  if ( !item?.system?.activities ) return null;
  const activities = Array.from(item.system.activities.values?.() ?? []).map(a => ({
    id: a.id, type: a.type, name: englishName(item, a),
    condition: item.flags?.babele?.originalPayload?.activities?.[a.id]?.condition ?? a.activation?.condition ?? "",
    effects: (a.effects ?? []).map(e => e._id ?? e.uuid),
    sizeAtMost: sizeLimitIn(item.flags?.babele?.originalPayload?.activities?.[a.id]?.target?.affects?.special
      ?? a.target?.affects?.special ?? "") ?? undefined
  }));
  return variantsOf(activities, englishDescription(item));
}

const bloodied = actor => {
  const hp = actor?.system?.attributes?.hp;
  return !!hp && (hp.value > 0) && (hp.value <= (hp.max / 2));
};

/** Centre d'un token en cases. */
function centerCells(p, size) {
  return { x: (p.x / size) + ((p.width ?? 1) / 2), y: (p.y / size) + ((p.height ?? 1) / 2) };
}

/** Pieds parcourus en ligne droite vers la cible juste avant l'attaque (core/variants.mjs, `straightChargeFeet`). */
export function chargedFeet(attacker, target) {
  const scene = attacker?.parent;
  const grid = scene?.grid;
  if ( !grid?.size || !target ) return 0;
  const here = committedPosition(attacker);
  const history = (attacker.movementHistory ?? []).map(w => ({ ...w, width: w.width ?? here.width, height: w.height ?? here.height }));
  const path = [...history, here].map(p => centerCells(p, grid.size));
  let cellFeet = lengthIn(grid.distance, grid.units, "ft");
  return straightChargeFeet(path, centerCells(committedPosition(target), grid.size), cellFeet);
}

/** Is the target grappled by the attacker (Grappled effect whose origin is an item of the attacker)? */
function grappledBy(target, attacker) {
  for ( const effect of target?.effects ?? [] ) {
    if ( !effect.active || !effect.statuses?.has("grappled") ) continue;
    const item = originItemOf(effect);
    if ( item?.actor && (item.actor === attacker) ) return true;
    if ( attacker?.uuid && String(effect.origin ?? "").startsWith(attacker.uuid) ) return true;
  }
  return false;
}

/**
 * The variant that this attack should take before the roll, or null (keep the activity).
 * Only the BASE attack is changed: a variant chosen by hand is respected.
 * @param {Activity} activity
 * @param {TokenDocument} attackerToken
 * @param {TokenDocument|null} targetToken
 * @returns {{activity: Activity, kind: string}|null}
 */
export function useTimeVariant(activity, attackerToken, targetToken) {
  const plan = variantPlanOf(activity?.item);
  if ( !plan || (activity.id !== plan.base) ) return null;
  const attacker = activity.actor;
  const target = targetToken?.actor ?? null;
  const id = chooseVariant(plan, {
    selfBloodied: bloodied(attacker),
    targetBloodied: bloodied(target),
    chargedFeet: target ? chargedFeet(attackerToken, targetToken) : 0,
    grappledBySelf: target ? grappledBy(target, attacker) : false,
    targetSize: target?.system?.traits?.size ?? undefined
  });
  const chosen = id ? activity.item.system.activities.get(id) : null;
  return chosen ? { activity: chosen, kind: plan.variants.find(v => v.id === id).kind } : null;
}

/** The "Attack with Advantage" variant of a base attack, or null. */
export function advantageVariantOf(activity) {
  const plan = variantPlanOf(activity?.item);
  const id = (plan && (activity.id === plan.base)) ? advantageVariant(plan) : null;
  return id ? activity.item.system.activities.get(id) : null;
}

/** The damage of a base attack whose roll had Advantage is rolled on its "with Advantage" variant. */
export function damageVariant(activity, attackRoll) {
  const plan = variantPlanOf(activity?.item);
  if ( !plan || (activity.id !== plan.base) ) return null;
  const advantage = attackRoll?.hasAdvantage ?? (attackRoll?.options?.advantageMode === 1);
  const id = advantage ? advantageVariant(plan) : null;
  return id ? activity.item.system.activities.get(id) : null;
}
