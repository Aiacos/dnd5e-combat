/**
 * §233: "do not roll these healing dice; instead, use the maximum value of each die" (Grave Domain's Return to Life,
 * Supreme Healing, Beacon of Hope). The dice terms of a formula become their maximum, before the roll: the card shows the
 * value returned. Pure.
 */

/**
 * The number of dice that count, modifiers read: `khN`, `klN`, `kN` keep only N (just one without a number); `dhN`, `dlN`,
 * `dN` remove N. The others (`r1`, `min2`, `x`…) do not change the number. A number written as an expression stays as it is.
 * @param {string} count      `4`, or `(expression)`.
 * @param {string} modifiers  The term's modifiers, stuck together (`r1kh3`).
 * @returns {string}
 */
function keptDice(count, modifiers) {
  let kept = count;
  for ( const token of modifiers.match(/[a-z]+[<>=]*\d*/gi) ?? [] ) {
    const [, kind, n] = /^(kh|kl|k|dh|dl|d)(\d*)$/i.exec(token) ?? [];
    if ( !kind ) continue;
    const by = Number(n || 1);
    const plain = /^\d+$/.test(kept);
    if ( kind[0].toLowerCase() === "k" ) kept = plain ? String(Math.min(Number(kept), by)) : `min(${kept}, ${by})`;
    else kept = plain ? String(Math.max(0, Number(kept) - by)) : `max(${kept} - ${by}, 0)`;
  }
  return kept;
}

/**
 * Each dice term `NdF`, `dF` or `(expression)dF` becomes `(N*F)`, N being the number of dice kept (`4d6kh3`: three); its
 * other modifiers (`r1`…) drop; the rest of the formula (bonus, `@abilities.wis.mod`) does not move. A word that contains
 * "d" followed by a digit (`dnd5e`) is not a die.
 * @param {string} formula
 * @returns {string}
 */
export function maximizeDice(formula) {
  return String(formula ?? "").replace(/(?<![\w@.])(\d+|\([^()]*\))?d(\d+)((?:[a-z]+[<>=]*\d*)*)/gi,
    (_, count, faces, modifiers) => `(${keptDice(count ?? "1", modifiers)}*${faces})`);
}
