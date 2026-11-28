/**
 * §516: Martial Savagery (`savageAttacker`, origin feat, SRD 5.2) — "once per turn, when you hit a target with a
 * weapon, you can roll the weapon's damage dice twice and use either roll". The character chooses the hit: in
 * "ask" mode (world setting, default), a checkbox in the "on hit" window (adapter/sneak.mjs, askHitOptions); if refused, it
 * stays for another hit of the same turn. In "auto" mode, the turn's first weapon hit, as before. The dice are rolled at the roll's
 * hook (runtime/feats.mjs); the turn in which it was used is an actor flag.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { combatantFor } from "./turn.mjs";

/** World setting: Martial Savagery is asked at each eligible hit ("ask") or applied automatically to the first ("auto"). */
export const SAVAGE_MODE_SETTING = "savageAttackerMode";
export const SAVAGE_MODES = Object.freeze(["ask", "auto"]);

/** The world's mode ("auto", the old behavior, if the setting is not readable). */
export function savageMode() {
  try {
    const mode = game.settings.get(MODULE_ID, SAVAGE_MODE_SETTING);
    return SAVAGE_MODES.includes(mode) ? mode : "auto";
  } catch { return "auto"; }
}

/** The combat turn the actor is fighting in ("combat.round.turn"), or null outside combat. */
export function savageTurnOf(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

/** A weapon attack (not unarmed) by an actor who has the rule. */
export function savageApplies(activity) {
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || (activity.item?.type !== "weapon") ) return false;
  if ( activity.attack?.type?.classification === "unarmed" ) return false;
  return Array.from(actor.items ?? []).some(i => contentOf(i).entry?.savageAttacker === true);
}

/** Already used this turn? (Outside combat: never, each hit may have it.) */
export function savageSpent(actor) {
  const turn = savageTurnOf(actor);
  return !!turn && (actor.getFlag(MODULE_ID, "savageAttacker") === turn);
}

/** Must the question be asked for this hit? ("ask" mode, rule applicable, not yet used this turn) */
export function savageToAsk(activity) {
  return (savageMode() === "ask") && savageApplies(activity) && !savageSpent(activity.actor);
}
