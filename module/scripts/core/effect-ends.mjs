/**
 * `effectEnds` (content): does an effect applied by an item end at this turn change? Pure function — the runtime reads the
 * actors and the turn in which the effect was applied, the decision is here.
 *
 *  - `casterTurnStart` / `bearerTurnStart`: at the start of the caster's, the bearer's turn;
 *  - `casterTurnEnd` / `bearerTurnEnd`: "until the end of your (its) next turn" — not the end of the turn in which the effect was
 *    applied;
 *  - `currentTurnEnd`: "until the end of the current turn" — the end of the turn in which the effect was applied, whoever's
 *    turn it is.
 *
 * @param {string} when                 the declared mode
 * @param {object} turn
 * @param {boolean} turn.casterStarts   the turn that is starting is the caster's
 * @param {boolean} turn.bearerStarts   … the bearer's
 * @param {boolean} turn.casterEnded    the turn that just ended was the caster's
 * @param {boolean} turn.bearerEnded    … the bearer's
 * @param {boolean} turn.placedInEnded  the effect was applied during the turn that just ended
 * @returns {boolean}
 */
export function effectEndsNow(when, turn={}) {
  const { casterStarts=false, bearerStarts=false, casterEnded=false, bearerEnded=false, placedInEnded=false } = turn;
  switch ( when ) {
    case "casterTurnStart": return casterStarts;
    case "bearerTurnStart": return bearerStarts;
    case "bearerTurnEnd": return bearerEnded && !placedInEnded;
    case "casterTurnEnd": return casterEnded && !placedInEnded;
    case "currentTurnEnd": return placedInEnded;
    default: return false;
  }
}
