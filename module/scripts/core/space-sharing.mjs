/**
 * §105: sharing another creature's cell (Air, Fire, Water Form; Swarms; Gaseous Form; Mist Form). Pure.
 *
 * "can enter a creature's space and stop there": the one who moves (`enter`) passes through any creature, hostile included, and
 * can end in its cell. "can occupy another creature's space and vice versa" (`mutual`): also the reverse — any creature
 * can enter theirs. The rest does not change: the occupied cell stays Difficult Terrain, the Opportunity Attack
 * is still due.
 */

export const SHARE_KINDS = Object.freeze(["enter", "mutual"]);

/** The broadest of two ways of sharing (null < enter < mutual). */
export function widerShare(a, b) {
  return SHARE_KINDS.indexOf(b) > SHARE_KINDS.indexOf(a) ? b : (a ?? null);
}

/**
 * Can the one who moves pass through the occupant's cell and stop there?
 * @param {"enter"|"mutual"|null} mover
 * @param {"enter"|"mutual"|null} occupant
 */
export function mayShareSpace(mover, occupant) {
  return !!mover || (occupant === "mutual");
}
