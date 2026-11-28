/**
 * Hearing (§62): where is a creature you cannot see? 2024 rule: you know where an Invisible creature or one in an area of no
 * visibility is — you hear it —, unless it is Hidden (a successful Hide: its position is unknown until it is
 * found). You can then attack it, with Disadvantage, but not target it with an effect that requires seeing it. No range: only
 * walls that block sound, the observer's deafness and the target's silence count. Pure functions.
 */

/**
 * Does the observer hear the target?
 * @param {object} state
 * @param {boolean} state.deafened      The observer is Deafened.
 * @param {boolean} state.hidden        The target is Hidden (the engine's Stealth).
 * @param {boolean} state.silent        The target makes no noise (dead).
 * @param {boolean} state.soundBlocked  A wall that blocks sound separates them.
 * @param {boolean} state.outOfRange    `hearingRange` setting (house rule): the target is beyond hearing range.
 */
export function hears({ deafened=false, hidden=false, silent=false, soundBlocked=false, outOfRange=false }) {
  return !deafened && !hidden && !silent && !soundBlocked && !outOfRange;
}

/**
 * `hearingRange` setting: an observer's hearing range. The rules give none — it is a house rule, off by
 * default. `value`: what the setting's formula gives for them; null — no range — if the setting is empty or if the formula does not
 * give a positive number or zero.
 * @param {*} value
 * @returns {number|null}
 */
export function hearingRange(value) {
  return ((typeof value === "number") && Number.isFinite(value) && (value >= 0)) ? value : null;
}

/** Is the target beyond hearing range? `range` null: there is no range. */
export function beyondHearing(distance, range) {
  return (range !== null) && (range !== undefined) && !(distance <= range);
}

/**
 * Is the target's position unknown to the observer? Hidden and neither seen nor otherwise perceived: it cannot be targeted.
 * @param {{hidden: boolean, sees: boolean|null}} state  `sees`: null when vision cannot decide (we let it through).
 */
export function locationUnknown({ hidden=false, sees=null }) {
  return hidden && (sees === false);
}
