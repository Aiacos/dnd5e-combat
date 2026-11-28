/**
 * O9h (§363): a duration written as a formula ("2d4" minutes: Dust of Disappearance), rolled once. Pure: no
 * dependency on Foundry. Allowed formulas: a sum of "NdM" terms and integers ("2d4", "1d6 + 2", "3").
 */

const SECONDS = Object.freeze({ seconds: 1, minutes: 60, hours: 3600 });

/**
 * The formula's total, with `random` (∈ [0, 1[) for the dice; null if the formula is not of this form.
 * @param {string} formula
 * @param {() => number} [random]
 */
export function rollSimple(formula, random=Math.random) {
  const terms = String(formula ?? "").replace(/\s+/g, "").replace(/-/g, "+-").split("+").filter(Boolean);
  if ( !terms.length ) return null;
  let total = 0;
  for ( const term of terms ) {
    const dice = term.match(/^(-?)(\d*)d(\d+)$/i);
    if ( dice ) {
      const [, sign, n, faces] = dice;
      let sum = 0;
      for ( let i = 0; i < (Number(n) || 1); i++ ) sum += 1 + Math.floor(random() * Number(faces));
      total += sign ? -sum : sum;
    }
    else if ( /^-?\d+$/.test(term) ) total += Number(term);
    else return null;
  }
  return total;
}

/** The duration in seconds of a `{ seconds }` or `{ formula, units }` rule; null if unreadable or zero. */
export function durationSeconds(rule, random=Math.random) {
  if ( Number.isFinite(rule?.seconds) ) return rule.seconds > 0 ? rule.seconds : null;
  const total = rollSimple(rule?.formula, random);
  const factor = SECONDS[rule?.units];
  return (Number.isFinite(total) && factor && (total > 0)) ? total * factor : null;
}
