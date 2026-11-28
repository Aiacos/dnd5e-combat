/**
 * Superior Hunter's Prey (Ranger, Hunter 11 — SRD 5.2): "once per turn, when you deal damage to a creature
 * marked by your Hunter's Mark, you can also deal the extra damage of that spell to a different creature that
 * you can see within 30 feet of the first". Pure functions.
 */

/**
 * The creatures that can receive this damage: not the first one, seen by the Ranger, enemies, within range of the first — from the
 * nearest to the farthest, `limit` at most.
 * @param {Array<{id: string, name: string, distance: number, enemy: boolean, seen: boolean, first?: boolean}>} tokens
 *   `distance`: to the FIRST creature
 * @param {number} range
 * @param {number} [limit]
 */
export function splashTargets(tokens, range, limit=8) {
  return (tokens ?? []).filter(t => !t.first && t.enemy && t.seen && (t.distance <= range))
    .sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/** Once per turn: the turn of the last use is not this one (outside combat, no turn to count). */
export function splashAvailable(usedTurn, turn) {
  return (turn === null) || (usedTurn !== turn);
}

/** The damage formula: that of the rule, or the one that another feature on the sheet substitutes for it (Foe Slayer). */
export function splashFormula(rule, features) {
  const has = new Set(features ?? []);
  const upgrade = (rule.upgrades ?? []).find(u => has.has(u.feature));
  return upgrade?.formula ?? rule.formula;
}
