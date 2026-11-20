/**
 * §492 : le registre « qui a attaqué qui ce tour » sur le Combat en cours (`flags.dnd5e-combat.attacksThisTurn`), lisible par tous les
 * clients, écrit par l'exécutant au verdict d'une attaque (runtime/engine-commands.mjs, `echo`). Règle pure : core/attacked-this-turn.mjs.
 * Un tour = la clé `currentTurnKey()` (« combat.round.turn ») : une attaque d'opportunité pendant le tour d'un autre compte pour ce tour-là.
 */

import { MODULE_ID } from "../constants.mjs";
import { recordAttack, attacksDuring, attackKindOf } from "../core/attacked-this-turn.mjs";
import { currentTurnKey } from "./turn.mjs";

export const ATTACKS_FLAG = "attacksThisTurn";

const combatOf = combat => combat ?? globalThis.game?.combat ?? null;

/** Le registre du combat (ou du combat en cours), null sans combat. */
export function attacksLog(combat=null) {
  return combatOf(combat)?.getFlag?.(MODULE_ID, ATTACKS_FLAG) ?? null;
}

/**
 * Les genres d'attaque (`["melee"]`, `["ranged"]`, les deux, ou `[]`) de l'acteur `source` contre l'acteur `target` pendant le tour `turn`
 * (par défaut, le tour en cours).
 */
export function attackedDuring(source, target, { turn=null, combat=null }={}) {
  const c = combatOf(combat);
  if ( !c?.started || !source?.uuid || !target?.uuid ) return [];
  return attacksDuring(attacksLog(c), { turn: turn ?? currentTurnKey(), source: source.uuid, target: target.uuid });
}

let queue = Promise.resolve();

/**
 * Note une attaque résolue : `source` (acteur) a attaqué `targets` (acteurs) avec `activity`. Hors combat, rien. Les écritures sont mises à
 * la file : deux verdicts rapprochés ne s'écrasent pas.
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
