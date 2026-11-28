/**
 * §282: Heroic Inspiration (PHB 2024, Rules, "Heroic Inspiration") — "if you (a player character) have Heroic
 * Inspiration, you can reroll any die immediately after rolling it, and you must use the new roll".
 * With Advantage or Disadvantage, "you reroll only one of the d20s, your choice" (D20 Tests, "Interactions with Rerolls").
 *
 * What can be computed without Foundry: whether to offer it, what the roll is worth after the reroll.
 *
 * Pure functions, no dependency on Foundry.
 */

/** The three client settings: never, on every roll, only on a failure. */
export const HEROIC_MODES = Object.freeze(["on", "failure", "off"]);

/**
 * Should the reroll be offered, according to the setting of whoever answers? `failed`: the roll is a failure (true), a success
 * (false), or of unknown outcome (null: a free check whose DC the engine does not know — offered, up to the player to judge, like
 * Bardic Inspiration).
 */
export function heroicWanted(mode, failed) {
  if ( mode === "off" ) return false;
  if ( mode === "failure" ) return failed !== false;
  return true;
}

/**
 * The d20 a roll keeps: the only one, or the highest (Advantage) / the lowest (Disadvantage) of two.
 * @param {number[]} values
 * @param {"advantage"|"disadvantage"|null} mode
 */
export function keptOf(values, mode) {
  if ( !values.length ) return null;
  if ( mode === "advantage" ) return Math.max(...values);
  if ( mode === "disadvantage" ) return Math.min(...values);
  return values[0];
}

/**
 * The roll after one of its d20s is rerolled: the d20 `index` becomes `value`, the kept d20 is recomputed, and the total moves
 * by the difference (bonuses stay). `critical` / `fumble`: die thresholds (20 and 1 by default; 19 for a Champion).
 * @param {{values: number[], mode: string|null, total: number, criticalSuccess?: number, criticalFailure?: number}} roll
 * @param {number} index
 * @param {number} value
 * @returns {{values: number[], old: number, kept: number, total: number, delta: number, critical: boolean, fumble: boolean}}
 */
export function rerolledD20({ values, mode=null, total, criticalSuccess=20, criticalFailure=1 }, index, value) {
  const old = keptOf(values, mode);
  const after = values.map((v, i) => (i === index ? value : v));
  const kept = keptOf(after, mode);
  const delta = kept - old;
  return { values: after, old, kept, total: total + delta, delta, critical: kept >= criticalSuccess, fumble: kept <= criticalFailure };
}

/**
 * In "only on a failure" mode, a damage roll has no failure: it is offered when at least one die came up half its
 * maximum or less (user's choice, 2026-10-30: 1 to 3 on a d6).
 * @param {Array<{faces: number, value: number}>} dice
 */
export function damageDiceLow(dice) {
  return dice.some(d => d.value <= d.faces / 2);
}

/**
 * The total of a damage type after one of its dice is rerolled (never below zero).
 * @param {number} value  The total of this type before.
 * @param {number} old    The die before.
 * @param {number} now    The die after.
 */
export function rerolledDamage(value, old, now) {
  return Math.max(0, value + now - old);
}

/**
 * §435: the dice that count in the terms of a roll — one die from each dice term (`faces`, `results`), and, in a pool (`PoolTerm`:
 * `{2d6,2d6}kh` of Savage Attacker), only the rolls the pool keeps: rerolling a die of the discarded roll would change
 * nothing in the total. A discarded, rerolled or inactive result does not count. Plain objects: `{ faces, results, modifiers }`
 * or `{ rolls, results }`.
 * @param {object[]} terms
 * @returns {Array<{term: object, result: object, index: number}>}  `index`: the place of the result in its term
 */
export function liveDice(terms) {
  const out = [];
  for ( const term of terms ?? [] ) {
    if ( Array.isArray(term?.rolls) ) {
      term.rolls.forEach((roll, i) => {
        const r = term.results?.[i];
        if ( r && ((r.active === false) || r.discarded) ) return;
        out.push(...liveDice(roll?.terms));
      });
      continue;
    }
    if ( !Number.isFinite(term?.faces) || !Array.isArray(term.results) ) continue;
    term.results.forEach((res, index) => {
      if ( (res.active === false) || res.rerolled || res.discarded ) return;
      out.push({ term, result: res, index });
    });
  }
  return out;
}
