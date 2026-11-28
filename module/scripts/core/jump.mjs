/**
 * §208: jumping under the 2024 rules (Player's Handbook glossary, "Long Jump" and "High Jump"; survey `prive/RELEVE_REGLES.md`).
 *  - Long Jump: up to the Strength score in feet with a running start (at least 10 feet on foot just before), half without.
 *  - High Jump: 3 + Strength modifier feet (at least 0) with a running start, half without.
 *  - Each foot of jump costs a foot of movement.
 *  - Landing in Difficult Terrain: Dexterity (Acrobatics) check DC 10, otherwise Prone.
 * What changes it, through content (`jump`): Athlete (5-foot running start), Jumper (Dexterity instead of Strength), Step of
 * the Wind (distance doubled for the turn), the *Jump* spell and Boots of Striding and Springing (once per turn, up to 30 feet
 * for 10 feet of movement).
 * All lengths are in feet; conversion to the grid is done by the caller.
 *
 * Pure: no dependency on Foundry.
 */

/** The running start the rules ask for, in feet. */
export const RUN_UP = 10;
/** The DC of the landing check in Difficult Terrain. */
export const LANDING_DC = 10;

const modOf = score => Math.floor(((Number(score) || 10) - 10) / 2);

/**
 * The jump distances, in feet (rounded down).
 * @param {object} data
 * @param {number} data.str            Strength score.
 * @param {number} [data.dex]          Dexterity score.
 * @param {boolean} [data.useDex]      Dexterity can replace Strength (Jumper): the better of the two.
 * @param {boolean} data.runningStart  Running start taken.
 * @param {boolean} [data.double]      Distance doubled (Step of the Wind).
 * @returns {{long: number, high: number, score: number}}
 */
export function jumpLimits({ str, dex=10, useDex=false, runningStart, double=false }) {
  const score = useDex ? Math.max(Number(str) || 10, Number(dex) || 10) : (Number(str) || 10);
  const factor = double ? 2 : 1;
  const long = Math.floor((runningStart ? score : score / 2) * factor);
  const high0 = Math.max(0, 3 + modOf(score));
  const high = Math.floor((runningStart ? high0 : high0 / 2) * factor);
  return { long, high, score };
}

/**
 * What a jump of `distance` feet costs and whether it is allowed. A "fixed" jump (*Jump* spell, Boots): once per turn, up to
 * `fixed.distance` for `fixed.cost` — taken if it allows the jump or makes it cheaper.
 * @param {number} distance        The length (or height) of the jump, in feet.
 * @param {number} limit           The ordinary limit (`jumpLimits`), in feet.
 * @param {{distance: number, cost: number}|null} [fixed]  The fixed jump available this turn, or null.
 * @returns {{ok: boolean, cost: number, fixed: boolean, limit: number}}  `cost` in feet; `limit`: the greatest distance allowed.
 */
export function jumpCost(distance, limit, fixed=null) {
  const d = Math.max(0, Number(distance) || 0);
  const viaFixed = !!fixed && (d <= fixed.distance) && ((d > limit) || (fixed.cost < d));
  if ( viaFixed ) return { ok: true, cost: fixed.cost, fixed: true, limit: Math.max(limit, fixed.distance) };
  return { ok: d <= limit + 1e-6, cost: d, fixed: false, limit: Math.max(limit, fixed?.distance ?? 0) };
}

/**
 * The running start: does the token's last walk, just before the jump, cover at least `needed` feet? `steps`: the lengths of
 * the last steps, from oldest to most recent, and the mode of each; the walk counts from the end, as long as the token was walking.
 * @param {{distance: number, action: string|null}[]} steps
 * @param {number} needed
 */
export function hasRunningStart(steps, needed=RUN_UP) {
  let run = 0;
  for ( let i = steps.length - 1; i >= 0; i-- ) {
    const s = steps[i];
    if ( !["walk", null, undefined].includes(s.action) ) break;
    run += Math.max(0, Number(s.distance) || 0);
    if ( run + 1e-6 >= needed ) return true;
  }
  return false;
}
