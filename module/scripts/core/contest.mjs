/**
 * §72: the contest (content key `contest`) — pure functions.
 */

/**
 * The outcome of a contest: the author wins on a strictly higher total; on a tie nothing changes (2024 rules,
 * "Contests": the situation stays as it is), so the author does not win.
 * @param {number} mine      The author's total.
 * @param {number} theirs    The target's total.
 * @returns {"win"|"lose"|"tie"}
 */
export function contestOutcome(mine, theirs) {
  if ( !Number.isFinite(mine) || !Number.isFinite(theirs) ) return "lose";
  if ( mine > theirs ) return "win";
  return (mine === theirs) ? "tie" : "lose";
}

/**
 * The skill the target opposes: among those allowed, the best for it (the highest total bonus).
 * @param {Record<string, number>} bonuses   Total bonus per skill (`system.skills.<clé>.total`).
 * @param {string[]} allowed
 * @returns {string|null}
 */
export function bestSkill(bonuses, allowed) {
  let best = null;
  for ( const key of allowed ?? [] ) {
    if ( !(key in (bonuses ?? {})) ) continue;
    if ( (best === null) || ((Number(bonuses[key]) || 0) > (Number(bonuses[best]) || 0)) ) best = key;
  }
  return best ?? allowed?.[0] ?? null;
}
