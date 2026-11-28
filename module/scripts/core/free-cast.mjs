/**
 * Divine Intervention (Cleric 10, SRD 5.2): "as a Magic action, choose a Cleric spell of level 5 or lower that does not
 * take a Reaction to cast; as part of the same action, you cast it without expending a spell slot or needing Material
 * components". The feature's activity holds the free cast; the next fitting spell takes it. Pure function.
 */

/**
 * Does this spell take the held free cast?
 * @param {{maxLevel: number, class?: string}} rule
 * @param {{isSpell: boolean, level: number, activation?: string|null, sourceClass?: string|null}} spell  `level`: the level of the
 *   spell; `sourceClass` empty: unknown, allowed
 */
export function freeCastApplies(rule, { isSpell, level, activation=null, sourceClass=null }) {
  if ( !rule || !isSpell || !(level >= 1) || (level > rule.maxLevel) || (activation === "reaction") ) return false;
  return !rule.class || !sourceClass || (sourceClass === rule.class);
}

/** Is the held cast still valid? Until the end of the turn when it was taken; outside combat, one minute. */
export function freeCastHeld(held, { turn=null, now=0 }={}) {
  if ( !held ) return false;
  if ( held.turn || turn ) return held.turn === turn;
  return (now - (Number(held.at) || 0)) <= 60;
}
