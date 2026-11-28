/**
 * §212: Burning ("Burning" hazard of the 2024 glossary) — who is on fire. dnd5e has the `burning` condition (config.mjs,
 * `statusEffects.burning`, token HUD pseudo-condition with no mechanics); to it are added the effects an item declares "Burning"
 * (`burns`: Alchemist's Fire, whose effect has only its name).
 */

import { contentOf } from "./content.mjs";
import { originItemOf, comesFromItemEffect } from "./facts.mjs";

export const BURNING = "burning";
/** "1d4 fire damage at the start of each of its turns". */
export const BURN_DAMAGE = Object.freeze({ formula: "1d4", type: "fire" });

/** Cet effet met-il en feu son porteur ? */
export function isBurningEffect(effect) {
  if ( !effect || effect.disabled || effect.isSuppressed ) return false;
  if ( effect.statuses?.has?.(BURNING) ) return true;
  const ids = contentOf(originItemOf(effect)).entry?.burns ?? [];
  return ids.some(id => comesFromItemEffect(effect, id));
}

/** The effects that set this actor on fire. */
export const burningEffectsOf = actor => (actor?.effects ?? []).filter(isBurningEffect);

/** L'acteur est-il en feu ? */
export const isBurning = actor => burningEffectsOf(actor).length > 0;

/** Immune to fire (it does not catch fire by spreading)? */
export const fireImmune = actor => !!actor?.system?.traits?.di?.value?.has?.("fire");
