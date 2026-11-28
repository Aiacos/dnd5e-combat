/**
 * Daze (Rogue's Cunning Strike, SRD 5.2): "on its next turn, the target can do only one of these
 * things: move, take an action, or take a Bonus Action". Pure functions, on the turn budget (core/turn.mjs).
 */

/**
 * The budget as the rule leaves it: what has already been done closes the other two doors.
 * @param {{action: number, bonus: number, limited?: number}} budget  the current budget
 * @param {{action: number, bonus: number}} fresh                    the budget of a fresh turn
 * @param {boolean} moved                                            the creature moved this turn
 */
export function oneThingBudget(budget, fresh, moved) {
  const acted = budget.action < fresh.action;
  const bonused = budget.bonus < fresh.bonus;
  if ( moved ) return { ...budget, action: 0, bonus: 0, limited: 0 };
  if ( acted ) return { ...budget, bonus: 0 };
  if ( bonused ) return { ...budget, action: 0, limited: 0 };
  return budget;
}

/** The creature took an action or a Bonus Action: it no longer moves this turn. */
export function oneThingStopsMove(budget, fresh) {
  return (budget.action < fresh.action) || (budget.bonus < fresh.bonus);
}
