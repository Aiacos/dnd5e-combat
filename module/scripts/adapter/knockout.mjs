/**
 * §210: knocking out a creature (2024 rules, glossary "Knocking Out a Creature") — "when you would reduce a creature to 0 HP
 * with a melee attack, you can leave it at 1 HP instead; it is Unconscious […] until it regains HP or is given first aid
 * (Wisdom (Medicine) DC 10)". The choice is made in advance, as in Baldur's Gate 3: a "non-lethal blows" switch per actor
 * (`flags.dnd5e-combat.nonLethal`, the DAS UI Bar and the token menu).
 */
import { MODULE_ID } from "../constants.mjs";

export const NON_LETHAL_FLAG = "nonLethal";
export const KNOCKED_OUT_FLAG = "knockedOut";
export const FIRST_AID_DC = 10;

/** Are this actor's blows non-lethal? */
export const isNonLethal = actor => actor?.getFlag?.(MODULE_ID, NON_LETHAL_FLAG) === true;

/** Is the creature knocked out (Unconscious at 1 HP from a non-lethal blow)? */
export const isKnockedOut = actor => !!actor?.getFlag?.(MODULE_ID, KNOCKED_OUT_FLAG);

/** Turns this actor's non-lethal blows on or off. */
export async function setNonLethal(actor, on) {
  if ( !actor?.isOwner ) return false;
  await actor.setFlag(MODULE_ID, NON_LETHAL_FLAG, !!on);
  return !!on;
}

/**
 * Is the blow of this damage message a non-lethal melee attack? Returns its author (the actor), or null. A thrown melee
 * weapon does not count (ranged attack), an Unarmed Strike does.
 */
export function nonLethalAttackerOf(options) {
  const message = options?.originatingMessage ?? options?.origin;
  const activity = message?.getAssociatedActivity?.() ?? null;
  const actor = activity?.actor ?? null;
  if ( !actor || !isNonLethal(actor) || (activity?.type !== "attack") ) return null;
  if ( activity.attack?.type?.value !== "melee" ) return null;
  const mode = String(message?.rolls?.[0]?.options?.attackMode ?? "");
  if ( mode.startsWith("thrown") || mode.startsWith("ranged") ) return null;
  return actor;
}

/**
 * `dnd5e.preApplyDamage`: non-lethal damage that would reduce the creature to 0 HP leaves it at 1 HP. Returns the author's
 * name, or null. `through`: the damage that gets past Temporary Hit Points.
 */
export function knockOutAtZero(actor, through, updates, options) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !(hp.value > 0) || (through < hp.value) ) return null;
  const attacker = nonLethalAttackerOf(options);
  if ( !attacker ) return null;
  updates["system.attributes.hp.value"] = 1;
  return attacker.name;
}
