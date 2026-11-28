/**
 * §36: Portent (Divination 3, Player's Handbook 2024) — on each Long Rest, the diviner rolls two d20s and keeps them in reserve.
 * Each can replace the result of a d20 Test of the diviner or of a creature they see, to be announced before the roll and at
 * most once per turn; a reserve d20 is used only once and those left are lost at the next Long Rest.
 * Greater Portent (14): three d20s.
 *
 * The state held on the diviner: { rolls: number[], turn: string|null } — `turn`: the game turn where it was used
 * ("combat.round.turn", adapter/turn.mjs), null outside combat (outside combat, no limit).
 *
 * Pure functions, no dependency on Foundry.
 */

/** The state read as is, returned clean: d20s (1 to 20, integers), a turn or null. */
export function readPortent(state) {
  const rolls = Array.isArray(state?.rolls) ? state.rolls.filter(n => Number.isInteger(n) && (n >= 1) && (n <= 20)) : [];
  return { rolls, turn: (typeof state?.turn === "string") ? state.turn : null };
}

/** Can they use it now? Remaining rolls, and not already this turn (in combat). */
export function canForetell(state, turnKey) {
  const { rolls, turn } = readPortent(state);
  return (rolls.length > 0) && !((turnKey !== null) && (turn === turnKey));
}

/** The values that can be offered, without duplicates, from highest to lowest. */
export function portentChoices(state) {
  return [...new Set(readPortent(state).rolls)].sort((a, b) => b - a);
}

/**
 * The noted roll is spent: a single occurrence of the value removed, the turn kept. null if the value is not (or no longer) noted.
 * @returns {{rolls: number[], turn: string|null}|null}
 */
export function spendPortent(state, value, turnKey) {
  const { rolls } = readPortent(state);
  const at = rolls.indexOf(value);
  if ( at < 0 ) return null;
  return { rolls: rolls.filter((_, i) => i !== at), turn: turnKey };
}

/** The replaced d20: roll bounds equal to the noted value (dnd5e: "1d20min7max7" is 7, Advantage included). */
export function foretoldRange(value) {
  return { minimum: value, maximum: value };
}
