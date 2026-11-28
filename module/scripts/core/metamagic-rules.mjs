/**
 * The Metamagic rules that depend on Innate Sorcery (SRD 5.2). Pure functions.
 *  - Metamagic: "you can use only one Metamagic option on a spell when you cast it, unless otherwise stated".
 *  - Sorcery Incarnate (Sorcerer 7): "while your Innate Sorcery feature is active, you can use up to two of your
 *    Metamagic options on each spell you cast".
 *  - Arcane Apotheosis (Sorcerer 20): "while your Innate Sorcery feature is active, you can use one Metamagic option on each
 *    of your turns without spending Sorcery Points".
 */

/**
 * How many options a spell can carry: the highest limit that the caster's active rules give, one otherwise.
 * @param {Array<{limit?: number, active: boolean}>} rules  the caster items' `metamagicRules`, and whether their effect is active
 */
export function metamagicLimit(rules) {
  return Math.max(1, ...(rules ?? []).filter(r => r.active && Number.isInteger(r.limit)).map(r => r.limit));
}

/**
 * Can this option still be held for the next spell? Already held: yes (nothing changes).
 * @param {string[]} held  the options already held
 * @param {string} kind
 * @param {number} limit
 */
export function mayHold(held, kind, limit) {
  return (held ?? []).includes(kind) || ((held ?? []).length < limit);
}

/**
 * Is the option taken without spending anything? An active `freePerTurn` rule, and no free option already taken this turn (outside
 * combat, no turn: always).
 * @param {Array<{freePerTurn?: true, active: boolean}>} rules
 * @param {{usedTurn: string|null, turn: string|null}} state  the turn of the last free option, the current turn
 */
export function freeOption(rules, { usedTurn=null, turn=null }={}) {
  if ( !(rules ?? []).some(r => r.active && (r.freePerTurn === true)) ) return false;
  return (turn === null) || (usedTurn !== turn);
}
