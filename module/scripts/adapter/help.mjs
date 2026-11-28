/**
 * Help (2024 rules), attack part: one distracts an enemy within 5 feet; the next attack
 * by one of OUR allies against it has Advantage, before the start of our next turn. The mark is an
 * effect on the enemy (`flags["dnd5e-combat"].help`), placed and removed by the active GM (runtime/help.mjs);
 * the attacker's client reads it for the Advantage (adapter/conditions.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { areAllies } from "./factions.mjs";

/** The Help marks placed on an actor. */
export function helpMarksOn(actor) {
  return (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "help"));
}

/** §181: is the Help's author on the attacker's side? Factions if their token still exists, else the recorded disposition. */
function helperAllied(help, attackerToken) {
  const helper = help.helper ? fromUuidSync(help.helper, { strict: false }) : null;
  if ( helper && attackerToken ) return areAllies(helper, attackerToken);
  return help.disposition === attackerToken?.disposition;
}

/**
 * Does this attack benefit from a Help? There must be a mark on the target, placed by an ally of
 * the attacker (same disposition) who is not the attacker themselves.
 */
export function helpedAgainst(attackerToken, targetToken) {
  return helpMarksOn(targetToken?.actor).some(effect => {
    const help = effect.getFlag(MODULE_ID, "help");
    return helperAllied(help, attackerToken) && (help.helper !== attackerToken?.uuid);
  });
}

/** The marks that an attack by this attacker consumes on this target. */
export function helpMarksUsedBy(attackerToken, targetToken) {
  return helpMarksOn(targetToken?.actor).filter(effect => {
    const help = effect.getFlag(MODULE_ID, "help");
    return helperAllied(help, attackerToken) && (help.helper !== attackerToken?.uuid);
  });
}

/** Places a Help mark on the target, in the name of the one who helps. */
export async function markHelped(targetToken, helperToken, { name, img }) {
  const actor = targetToken?.actor;
  if ( !actor ) return null;
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name, img, transfer: false, disabled: false, statuses: [], changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { help: { helper: helperToken.uuid, disposition: helperToken.disposition } } }
  }]);
  return effect ?? null;
}
