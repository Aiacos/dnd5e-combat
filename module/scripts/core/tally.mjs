/**
 * Repeated-save counter (SPEC §43.1): "up to three successes or three failures" — Contagion, Flesh to Stone.
 * Successes and failures need not be consecutive; only REPLAYED saves count (not the one at casting).
 * Pure: the state lives in an effect flag, the engine writes it.
 */

/**
 * The counter state after a save.
 * @param {{successes?: number, failures?: number}|null} state   The previous state (effect flag), or nothing.
 * @param {boolean} success                                      Has the save just succeeded?
 * @param {{successes: number, failures: number}} rule           The thresholds.
 * @returns {{successes: number, failures: number, settled: boolean, outcome: "ended"|"settled"|null}}
 *   `ended`: the success threshold is reached, the effect ends; `settled`: the failure threshold is reached, the effect stays and
 *   no more saves are replayed.
 */
export function tallyAfter(state, success, rule) {
  const successes = (Number(state?.successes) || 0) + (success ? 1 : 0);
  const failures = (Number(state?.failures) || 0) + (success ? 0 : 1);
  const outcome = (successes >= rule.successes) ? "ended" : ((failures >= rule.failures) ? "settled" : null);
  return { successes, failures, settled: outcome === "settled", outcome };
}

/** Is the counter closed (failure threshold reached)? No more saves to replay. */
export const tallySettled = state => state?.settled === true;

/**
 * §495 (brick B15): condition ladder on repeated saves — a poison that worsens with each failure (Poisoned → slowed → Paralyzed)
 * and recedes with each success. Stage 0 is the applied effect itself; stages 1…N are those of the rule (`stages`).
 * @param {number|null} level                 The previous stage (0: the effect alone).
 * @param {boolean} success                   Has the save just succeeded?
 * @param {{count: number, onSuccess?: "down"|"end", natural20?: boolean, critEnds?: boolean}} rule
 *   `count`: the number of stages; `onSuccess`: "down" (default) drops one stage — the effect ends if it was at stage 0 —,
 *   "end" ends it at once; `natural20`: the save is a natural 20; `critEnds`: a natural 20 ends it, even if the DC is not
 *   reached.
 * @returns {{level: number, outcome: "ended"|"up"|"down"|"same"}}
 */
export function stageAfter(level, success, { count, onSuccess="down", natural20=false, critEnds=false }) {
  const from = Math.max(0, Math.min(Number(level) || 0, count));
  if ( natural20 && critEnds ) return { level: from, outcome: "ended" };
  if ( !success ) return (from >= count) ? { level: from, outcome: "same" } : { level: from + 1, outcome: "up" };
  if ( (onSuccess === "end") || (from === 0) ) return { level: from, outcome: "ended" };
  return { level: from - 1, outcome: "down" };
}
