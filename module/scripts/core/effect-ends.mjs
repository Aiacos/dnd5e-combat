/**
 * `effectEnds` (contenu) : un effet posé par un item tombe-t-il à ce changement de tour ? Fonction pure — le runtime lit les
 * acteurs et le tour où l'effet a été posé, la décision est ici.
 *
 *  - `casterTurnStart` / `bearerTurnStart` : au début du tour du lanceur, du porteur ;
 *  - `casterTurnEnd` / `bearerTurnEnd` : « jusqu'à la fin de votre (son) prochain tour » — pas la fin du tour où l'effet a été
 *    posé ;
 *  - `currentTurnEnd` : « jusqu'à la fin du tour en cours » — la fin du tour où l'effet a été posé, à qui que soit ce tour.
 *
 * @param {string} when                 le mode déclaré
 * @param {object} turn
 * @param {boolean} turn.casterStarts   le tour qui commence est celui du lanceur
 * @param {boolean} turn.bearerStarts   … celui du porteur
 * @param {boolean} turn.casterEnded    le tour qui vient de finir était celui du lanceur
 * @param {boolean} turn.bearerEnded    … celui du porteur
 * @param {boolean} turn.placedInEnded  l'effet a été posé pendant le tour qui vient de finir
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
