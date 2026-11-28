/**
 * §250: the rounds of an Initiative event (runtime/combat-events.mjs). Pure.
 */

/**
 * From the current round (0 before combat starts: it will play in round 1) for `rounds` rounds; `rounds` null or ≤ 0: no end
 * (`until` null).
 * @returns {{ from: number, until: number|null }}
 */
export function eventRounds(round, rounds=1) {
  const from = Math.max(1, Math.floor(Number(round) || 0));
  const n = Math.floor(Number(rounds));
  return { from, until: (rounds === null) || !(n > 0) ? null : from + n - 1 };
}

/** Has the event ended, once its turn of round `round` has been played? */
export function eventEnded(event, round) {
  return Number.isFinite(event?.until) && Number.isFinite(Number(round)) && (Number(round) >= event.until);
}
