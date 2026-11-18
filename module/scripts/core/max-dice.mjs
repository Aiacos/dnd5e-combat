/**
 * §233 : « ne lancez pas ces dés de soin ; retenez à la place la valeur maximale de chaque dé » (Retour à la vie du Domaine de la
 * Tombe, Guérison suprême, Lueur d'espoir). Les termes de dés d'une formule deviennent leur maximum, avant le jet : la carte montre la
 * valeur rendue. Pur.
 */

/**
 * Le nombre de dés qui comptent, modificateurs lus : `khN`, `klN`, `kN` n'en gardent que N (un seul sans nombre) ; `dhN`, `dlN`,
 * `dN` en retirent N. Les autres (`r1`, `min2`, `x`…) ne changent pas le nombre. Un nombre écrit en expression le reste.
 * @param {string} count      `4`, ou `(expression)`.
 * @param {string} modifiers  Les modificateurs du terme, collés (`r1kh3`).
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
 * Chaque terme de dés `NdF`, `dF` ou `(expression)dF` devient `(N*F)`, N étant le nombre de dés gardés (`4d6kh3` : trois) ; ses
 * autres modificateurs (`r1`…) tombent ; le reste de la formule (bonus, `@abilities.wis.mod`) ne bouge pas. Un mot qui contient
 * « d » suivi d'un chiffre (`dnd5e`) n'est pas un dé.
 * @param {string} formula
 * @returns {string}
 */
export function maximizeDice(formula) {
  return String(formula ?? "").replace(/(?<![\w@.])(\d+|\([^()]*\))?d(\d+)((?:[a-z]+[<>=]*\d*)*)/gi,
    (_, count, faces, modifiers) => `(${keptDice(count ?? "1", modifiers)}*${faces})`);
}
