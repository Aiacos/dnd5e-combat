/**
 * §130: what a feat's effect must know about its bearer (core/feats.mjs, `effectHolds`) — the armor worn (dnd5e computes it:
 * `system.attributes.ac.equippedArmor`), the weapons wielded (equipped, excluding natural weapons and Unarmed Strike), combat,
 * the ability scores.
 */

import { combatantFor } from "./turn.mjs";
import { identifierOf } from "./content.mjs";
import { lightAt } from "./illumination.mjs";
import { LIGHT_NAMES } from "../core/illumination.mjs";

/** §135: the light at the center of the bearer's token ("dark", "dim", "bright"), or null without a token or canvas. */
export function lightOfActor(actor) {
  const token = actor?.getActiveTokens?.(false, true)?.[0];
  if ( !token?.parent ) return null;
  const size = token.parent.grid?.size ?? 100;
  const level = lightAt({ x: token._source.x + ((token.width ?? 1) * size) / 2, y: token._source.y + ((token.height ?? 1) * size) / 2,
    elevation: token._source.elevation ?? 0 })?.level;
  return Number.isInteger(level) ? (LIGHT_NAMES[level] ?? null) : null;
}

const RANGED = ["simpleR", "martialR"];

/** @returns {{armor: string|null, weapons: Array<{melee: boolean, twoHanded: boolean}>, inCombat: boolean, abilities: Record<string, number>}} */
/**
 * C12-c: the identifiers of the items the actor's Active Effects come from, transferred ones included — the core's
 * `allApplicableEffects`: `appliedEffects` only keeps effects that change something ("Starry Form" has no change).
 */
function effectOrigins(actor) {
  const out = new Set();
  const all = (typeof actor?.allApplicableEffects === "function") ? [...actor.allApplicableEffects()] : (actor?.effects ?? []);
  for ( const effect of all ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = (effect.parent?.documentName === "Item") ? effect.parent : (fromUuidSync(effect.origin ?? "", { strict: false }) ?? null);
    const id = (item?.documentName === "Item") ? identifierOf(item).id : null;
    if ( id ) out.add(id);
  }
  return out;
}

export function effectFacts(actor) {
  const armor = actor?.system?.attributes?.ac?.equippedArmor?.system?.type?.value ?? null;
  const weapons = (actor?.items ?? []).filter(i => (i.type === "weapon") && i.system.equipped && (i.system.type?.value !== "natural")
    && (identifierOf(i).id !== "unarmed-strike")).map(w => ({ melee: !RANGED.includes(w.system.type?.value), twoHanded: !!w.system.properties?.has?.("two") }));
  const abilities = Object.fromEntries(Object.entries(actor?.system?.abilities ?? {}).map(([k, v]) => [k, Number(v?.value) || 0]));
  // O7 (§343): an equipped shield (Bracers of Defense).
  const shield = !!actor?.system?.attributes?.ac?.equippedShield;
  return { armor, shield, weapons, inCombat: !!combatantFor(actor)?.parent?.started, abilities, get light() { return lightOfActor(actor); },
    // C12-c: under a Wild Shape (dnd5e's polymorphed actor); the identifiers of the items its Active Effects come from.
    wildShaped: !!actor?.isPolymorphed,
    get effectsFrom() { return effectOrigins(actor); } };
}
