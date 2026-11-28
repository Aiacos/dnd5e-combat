/**
 * Extended Spell (Metamagic, SRD 5.2): "when you cast a spell that has a duration of 1 minute or longer, you can spend
 * 1 Sorcery Point to double its duration, to a maximum of 24 hours; if the spell requires Concentration, you have
 * Advantage on saving throws to maintain it". Pure function.
 */

const SECONDS = Object.freeze({ seconds: 1, second: 1, rounds: 6, round: 6, turns: 6, turn: 6, minutes: 60, minute: 60, hours: 3600,
  hour: 3600, days: 86400, day: 86400 });
const DAY = 86400;

/**
 * The doubled duration of an effect, in seconds, or null if Extended Spell does not apply (under a minute, no numeric
 * duration).
 * A duration already equal to or greater than 24 hours is not lengthened.
 * @param {{value?: number|string|null, units?: string|null}|null|undefined} duration
 * @returns {number|null}
 */
export function extendedSeconds(duration) {
  const value = Number(duration?.value);
  const unit = SECONDS[String(duration?.units ?? "")];
  if ( !Number.isFinite(value) || !(value > 0) || !unit ) return null;
  const seconds = value * unit;
  if ( (seconds < 60) || (seconds >= DAY) ) return null;
  return Math.min(seconds * 2, DAY);
}
