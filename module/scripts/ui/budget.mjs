/**
 * The turn budget as the interface shows it (SPEC §6, §9.1) — the combat tracker — and what a click on it asks for.
 * An external interface reads the same budget through `api.ui` (ui/api.mjs, §40.1). No rule here: the budget comes from
 * adapter/turn.mjs, the changes from core/turn.mjs.
 */

import { dash, disengage, dodge, toggleResource, movementAllowance } from "../core/turn.mjs";
import { isOwnTurn, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { multiattackLeft } from "../adapter/multiattack.mjs";
import { loc } from "../runtime/shared.mjs";

export const RESOURCES = ["action", "bonus", "reaction"];

/** The common turn gestures, in display order: key, label, budget flag that says "already done". */
export const COMMONS = [["dash", "Foncer", "dashed"], ["disengage", "SeDesengager", "disengaged"], ["dodge", "Esquiver", "dodging"]];

/** A player sees the budget of their own combatants and those of other players, not that of the GM's NPCs. */
export const budgetVisible = combatant => !!combatant?.actor && (combatant.isOwner || combatant.hasPlayerOwner);

const round = n => Math.round(n * 10) / 10;

/**
 * What the interface shows of a combatant's budget.
 * @param {Combatant} combatant
 */
export function budgetView(combatant) {
  const budget = readBudget(combatant);
  const editable = combatant.isOwner;
  const ownTurn = isOwnTurn(combatant);
  // An action stays available as long as the Attack action has attacks left to give.
  const attacksLeft = budget.attacks.used < budget.attacks.granted;
  const resources = RESOURCES.map(key => ({
    key, label: loc(`Pastille.${key}`),
    available: (budget[key] > 0) || ((key === "action") && attacksLeft)
  }));
  let attacks = null;
  if ( (budget.attacks.granted > 1) && (budget.attacks.granted < 99) ) {
    // §18.19: Multiple Attacks open — what remains, named.
    const status = budget.multi ? multiattackLeft(combatant.actor, budget.multi) : null;
    attacks = {
      used: budget.attacks.used, granted: budget.attacks.granted,
      text: loc("Attaques", { used: budget.attacks.used, granted: budget.attacks.granted }),
      tooltip: status ? (status.names.length ? loc("AttaquesRestantes", { names: status.names.join(", ") }) : loc("AttaquesEpuisees")) : null
    };
  }
  const m = movementOf(combatant, readUnitFactors());
  let movement = null;
  if ( m ) {
    const allowance = movementAllowance(budget, m.speed);
    movement = { spent: round(m.spent), allowance: round(allowance), units: m.units, over: m.spent > allowance + 1e-6,
      left: round(Math.max(0, allowance - m.spent)) };
  }
  const commons = COMMONS.map(([key, label, flag]) => ({
    key, label: loc(label), done: !!budget[flag],
    // During its turn only, and against an action.
    enabled: editable && ownTurn && !budget[flag] && (budget.action >= 1)
  }));
  return { editable, ownTurn, resources, attacks, movement, commons };
}

/** A click by the owner: correct a resource (`action`, `bonus`, `reaction`) or make a common gesture. */
export async function applyBudgetIntent(combatant, key) {
  if ( !combatant?.isOwner ) return;
  const current = readBudget(combatant);
  const common = { dash, disengage, dodge }[key];
  if ( !common && !RESOURCES.includes(key) ) return;
  await writeBudget(combatant, common ? common(current) : toggleResource(current, key));
}
