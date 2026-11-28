/**
 * §492: the "who attacked whom this turn" registry on the current Combat (`flags.dnd5e-combat.attacksThisTurn`), readable by
 * all clients, written by the executor at an attack's verdict (runtime/engine-commands.mjs, `echo`).
 * Pure rule: core/attacked-this-turn.mjs. A turn = the key `currentTurnKey()` ("combat.round.turn"): an Opportunity Attack during
 * another creature's turn counts for that turn.
 */

import { MODULE_ID } from "../constants.mjs";
import { recordAttack, attacksDuring, attackKindOf } from "../core/attacked-this-turn.mjs";
import { currentTurnKey } from "./turn.mjs";

export const ATTACKS_FLAG = "attacksThisTurn";

const combatOf = combat => combat ?? globalThis.game?.combat ?? null;

/** The combat's registry (or the current combat's), null without combat. */
export function attacksLog(combat=null) {
  return combatOf(combat)?.getFlag?.(MODULE_ID, ATTACKS_FLAG) ?? null;
}

/**
 * The attack kinds (`["melee"]`, `["ranged"]`, both, or `[]`) of actor `source` against actor `target` during turn `turn`
 * (by default, the current turn).
 */
export function attackedDuring(source, target, { turn=null, combat=null }={}) {
  const c = combatOf(combat);
  if ( !c?.started || !source?.uuid || !target?.uuid ) return [];
  return attacksDuring(attacksLog(c), { turn: turn ?? currentTurnKey(), source: source.uuid, target: target.uuid });
}

let queue = Promise.resolve();

/**
 * Records a resolved attack: `source` (actor) attacked `targets` (actors) with `activity`. Outside combat, nothing.
 * Writes are queued: two close verdicts do not overwrite each other.
 */
export function noteAttack(source, targets, activity, { attackMode=null }={}) {
  const combat = combatOf();
  const turn = currentTurnKey();
  const kind = attackKindOf({ activityType: activity?.type ?? null, attackType: activity?.attack?.type?.value ?? null, attackMode });
  if ( !combat?.started || !turn || !kind || !source?.uuid ) return queue;
  const ids = targets.map(t => t?.uuid).filter(Boolean);
  queue = queue.then(async () => {
    const next = recordAttack(attacksLog(combat), { turn, source: source.uuid, targets: ids, kind });
    if ( next ) await combat.setFlag(MODULE_ID, ATTACKS_FLAG, next);
  }).catch(err => console.error(`${MODULE_ID} | attacks of the turn not recorded`, err));
  return queue;
}
