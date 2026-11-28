/**
 * Undead Fortitude (§61) seen from Foundry: the item that carries it (content `fortitude`, by identifier) and the pending
 * save. The damage that triggers it is read in `dnd5e.preApplyDamage` (adapter/death.mjs, `planDamageAtZero`): the
 * due save goes out in the same write as the HP, as an actor flag, and the active GM then plays it
 * (runtime/fortitude.mjs). While it waits, the creature is neither Dead nor Unconscious (`ensureDowned`).
 */

import { MODULE_ID } from "../constants.mjs";
import { fortitudeSave } from "../core/fortitude.mjs";
import { contentOf } from "./content.mjs";

const FLAG = "fortitude";

/** L'item de Robustesse de la non-vie de l'acteur, ou null. */
export function fortitudeOf(actor) {
  return (actor?.items ?? []).find(i => contentOf(i).entry?.fortitude === true) ?? null;
}

/** La sauvegarde en attente : `{ dc, item }`, ou null. */
export const pendingFortitude = actor => actor?.getFlag(MODULE_ID, FLAG) ?? null;

/**
 * `dnd5e.preApplyDamage`: if this damage drops the actor to 0 HP and the rule applies, the due save is recorded
 * in `updates` (written with the HP). Returns the save, or null.
 */
export function planFortitude(actor, hit, updates) {
  const item = fortitudeOf(actor);
  if ( !item ) return null;
  const save = fortitudeSave(hit);
  if ( !save ) return null;
  updates[`flags.${MODULE_ID}.${FLAG}`] = { dc: save.dc, item: item.name };
  return save;
}

export const clearFortitude = actor => actor.unsetFlag(MODULE_ID, FLAG);
