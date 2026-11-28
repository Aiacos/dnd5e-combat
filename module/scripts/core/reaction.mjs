/**
 * Reactions (SPEC §7): a window opens at a precise moment of a resolution, and only if
 * someone can answer it. Pure functions, no dependency on Foundry.
 *
 * Known windows:
 *  - "isHit"        the attack has just hit the creature, before damage (Shield)
 *  - "isDamaged"    the creature has just taken damage (Hellish Rebuke)
 *  - "leavesReach"  a hostile creature leaves reach (Opportunity Attack)
 */

import { hostileSides, neutralFacing } from "./factions.mjs";

/** Are two sides opposed? (defined with factions, §181; re-exported here for earlier callers) */
export { areHostile } from "./factions.mjs";

/**
 * The Reactions that a creature can offer in a window.
 * @param {Array<{on: string[]}>} declared   Canonical declarations of its items (core/triggers.mjs).
 * @param {string} window
 * @param {{reactionAvailable: boolean, incapacitated?: boolean}} state
 */
export function eligibleReactions(declared, window, { reactionAvailable, incapacitated=false }) {
  if ( incapacitated ) return [];
  // §129: a `free` declaration does not cost the Reaction (Lucky): offered even when the Reaction is taken.
  return declared.filter(r => r.on.includes(window) && (reactionAvailable || (r.free === true)));
}

/**
 * §136: the first step of a path that ENTERS a reach (from farther away to within range) — the index of the position reached,
 * or -1. A creature that starts already in range does not enter it.
 * @param {number[]} distances  The distance at each position of the path, start included.
 * @param {number} reach
 */
export function entersAt(distances, reach) {
  for ( let n = 0; n < distances.length - 1; n++ ) {
    if ( (distances[n] > reach + 1e-6) && (distances[n + 1] <= reach + 1e-6) ) return n + 1;
  }
  return -1;
}

/**
 * §136: Polearm Master, Reactive Strike — "you can take a Reaction to make a melee attack against a
 * creature that enters the reach you have with that weapon". This is not an Opportunity Attack: Disengage does not
 * avoid it. A teleportation does not enter reach "into" it by moving (accepted limit, like the Opportunity Attack).
 * @param {{disposition: number, teleported: boolean}} mover
 * @param {Array<{token: string, disposition: number, enters: number, reactionAvailable: boolean, incapacitated?: boolean,
 *   hasLineOfEffect?: boolean|null}>} others  `enters`: the entry index (entersAt), -1 if it does not enter.
 * @returns {string[]}
 */
export function reachStrikers(mover, others) {
  if ( mover.teleported ) return [];
  return others.filter(o => (o.enters >= 0) && o.reactionAvailable && !o.incapacitated && (o.hasLineOfEffect !== false)
    && hostileSides(mover, o)).map(o => o.token);
}

/**
 * Who can attempt an Opportunity Attack against a creature that has just moved.
 * We compare the start and arrival positions: leaving reach then coming back in the same
 * movement is not seen (accepted limit).
 * @param {object} mover
 * @param {number} mover.disposition
 * @param {boolean} mover.disengaged   Took the Disengage action this turn.
 * @param {boolean} mover.teleported   Teleportation or forced movement: no Opportunity Attack.
 * @param {Array<{token: string, disposition: number, before: number, after: number, reach: number,
 *   reactionAvailable: boolean, incapacitated?: boolean, hasMeleeAttack: boolean, seesMover?: boolean|null,
 *   hasLineOfEffect?: boolean|null}>} others
 *   `before`, `after` and `reach` in the same unit; `seesMover`: "a creature that you can
 *   see" (2024 rule) — false excludes it, null (unknown) does not exclude it; `hasLineOfEffect`: can it
 *   strike the one who moves (no floor, ceiling or Total Cover between them — P2, §14.2)? Same rule.
 * @returns {string[]}  UUIDs of the tokens that can react.
 */
export function opportunityAttackers(mover, others) {
  if ( mover.disengaged || mover.teleported ) return [];
  return others.filter(o =>
    o.hasMeleeAttack && o.reactionAvailable && !o.incapacitated && (o.seesMover !== false) && (o.hasLineOfEffect !== false)
    && hostileSides(mover, o)
    && (o.before <= o.reach + 1e-6) && (o.after > o.reach + 1e-6)
  ).map(o => o.token);
}

/**
 * §479: why a creature whose movement leaves its reach has NO Opportunity Attack — the first reason, in the order
 * of the conditions of `opportunityAttackers` (same entries). Nothing for those that do not leave reach or that can attack.
 * `notice`: the reason deserves to be told to the GM (it is surprising) — a Neutral side facing a Friendly or Hostile side with no
 * faction relation (a monster that stayed Neutral provokes nothing), a hostile creature with no usable melee attack, or that does
 * not see the one leaving. Two allies, a Reaction already taken, a Disengage: the rule reads itself, nothing is said.
 * @returns {Array<{token: string, reason: string, notice: boolean}>}
 */
export function opportunityMisses(mover, others) {
  const out = [];
  for ( const o of others ) {
    if ( !((o.before <= o.reach + 1e-6) && (o.after > o.reach + 1e-6)) ) continue;
    const reason = mover.teleported ? "teleported" : mover.disengaged ? "disengaged"
      : !hostileSides(mover, o) ? "notHostile" : !o.hasMeleeAttack ? "noMelee"
      : o.incapacitated ? "incapacitated" : !o.reactionAvailable ? "noReaction"
      : (o.seesMover === false) ? "cantSee" : (o.hasLineOfEffect === false) ? "noLineOfEffect" : null;
    if ( !reason ) continue;
    const notice = (reason === "notHostile") ? neutralFacing(mover, o) : ((reason === "noMelee") || (reason === "cantSee"));
    out.push({ token: o.token, reason, notice });
  }
  return out;
}
