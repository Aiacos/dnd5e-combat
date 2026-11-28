/**
 * §112: synchronize the application of a resolution with the animations (Sequencer, which BLFX uses) — which animations to
 * wait for. Pure functions, no dependency on Foundry.
 */

/**
 * The ongoing animations that concern these tokens: leaving or arriving at one of them, not persistent (an aura, a lasting area
 * never ends), started less than `recentMs` ago (the animation of a spell cast long ago does not count).
 * @param {Array<{id: string, source: string|null, target: string|null, persist: boolean, started: number, ended: boolean}>} effects
 * @param {Iterable<string>} uuids   The tokens of the resolution (the author, the targets).
 * @param {number} now
 * @param {{recentMs?: number}} [options]
 * @returns {string[]}  The ids of the animations to wait for.
 */
export function relevantAnimations(effects, uuids, now, { recentMs=3000 }={}) {
  const wanted = new Set([...uuids].filter(Boolean));
  if ( !wanted.size ) return [];
  return (effects ?? []).filter(e => !e.ended && !e.persist && ((now - e.started) <= recentMs)
    && (wanted.has(e.source) || wanted.has(e.target))).map(e => e.id);
}
