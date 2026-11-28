/**
 * §272: timers above tokens (searching, disarming, any gesture that takes time) — what is computed without Foundry.
 *
 * Pure: no dependency on Foundry.
 */

/** The DAS logo gradient (site darshyne.github.io, `--logo`), from left to right. */
export const TIMER_GRADIENT = Object.freeze(["#e005f4", "#ee0388", "#fc0016"]);

/** Gauge dimensions, as a fraction of a cell's width, and its edges. */
export const TIMER_LAYOUT = Object.freeze({ width: 0.9, height: 0.12, gap: 0.08, outline: 2, iconSize: 0.26 });

/**
 * Where a timer started at `startedAt` (ms) for `seconds` seconds stands, at time `now` (ms).
 * @returns {{pct: number, left: number, done: boolean}}  `left`: seconds remaining, rounded up.
 */
export function timerState({ startedAt, seconds }, now) {
  const total = Math.max(0, Number(seconds) || 0) * 1000;
  if ( !(total > 0) ) return { pct: 1, left: 0, done: true };
  const elapsed = Math.max(0, now - startedAt);
  const pct = Math.min(1, elapsed / total);
  return { pct, left: Math.max(0, Math.ceil((total - elapsed) / 1000)), done: elapsed >= total };
}

/** The text of the seconds remaining ("4 s"), or nothing when the table hides them. */
export function timerSecondsText(left, { hideSeconds=false, unit="s" }={}) {
  if ( hideSeconds || !Number.isFinite(left) ) return "";
  return `${left} ${unit}`;
}
