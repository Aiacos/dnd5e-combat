/**
 * §73: Death Ward (`death-ward`, content key `wardsAtZero`) — "the first time the target would drop to 0 Hit Points
 * before the spell ends, it drops to 1 Hit Point instead, and the spell ends". At `dnd5e.preApplyDamage`, before all
 * the rest of death (adapter/death.mjs, `planDamageAtZero`): damage that would drop it to 0 — even enough to kill it
 * outright, since it does not drop to it — leaves it at 1 HP, and the spell's effect is removed. "An effect that would kill it
 * outright without dealing damage" is cancelled: up to the GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** The Active Effect of a `wardsAtZero` spell that the actor bears, or null. */
export function deathWardOf(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    if ( contentOf(originItemOf(effect)).entry?.wardsAtZero === true ) return effect;
  }
  return null;
}

/**
 * Damage that would drop the creature to 0 HP: it stays at 1 HP (in the same update), and the effect ends. Returns the
 * removed effect, or null. `through`: the damage that gets past Temporary Hit Points.
 */
export function wardAtZero(actor, through, updates) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !(hp.value > 0) || (through < hp.value) ) return null;
  const effect = deathWardOf(actor);
  if ( !effect ) return null;
  updates["system.attributes.hp.value"] = 1;
  effect.delete().catch(err => console.warn(`${MODULE_ID} | ${effect.name}: effect not removed`, err));
  return effect;
}
