/**
 * Consecutive turns (content key `extraTurns`): Time Stop — "you take 1d4 + 1 turns in a row, during which you
 * can use actions and move normally". The remaining count is noted on the caster; at the end of each of its
 * turns, as long as some remain, combat comes back to it instead of moving on to the next. Pure functions.
 */

/**
 * Must the turn that just ended be replayed by the same combatant?
 * @param {{combat: string, left: number}|null|undefined} state  What the combatant whose turn ends carries.
 * @param {{combat: string, forward: boolean}} change         The combat, and whether the tracker moved on (not a GM step-back).
 */
export function takesAnotherTurn(state, { combat, forward }) {
  return !!state && (state.combat === combat) && (state.left > 0) && (forward === true);
}

/** Has the tracker moved forward from `prior` to `current`? (next round, or same round and later turn) */
export function movedForward(prior, current) {
  if ( !prior || !current ) return false;
  return (current.round > prior.round) || ((current.round === prior.round) && (current.turn > prior.turn));
}

/** The key's errors. Empty = valid. */
export function validateExtraTurns(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && (typeof rule.formula === "string") && rule.formula.trim()
    && Object.keys(rule).every(k => k === "formula");
  return ok ? [] : [`${at}extraTurns: { formula }`];
}
