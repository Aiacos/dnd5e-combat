/**
 * §501 (block B21) — "if it would lose its Reactions, it loses only one": `reactions: { perRound, loseOne: true }`. Pure
 * rules. What usually removes Reactions (Incapacitated condition, effect of an item `noReactions`) no longer blocks the
 * creature: each new effect of this kind removes a single Reaction from it for the round. Dead, unconscious or petrified, it
 * still does not react.
 */

/** The conditions that always prevent reacting, even with `loseOne`. */
export const HARD_STOPS = Object.freeze(["dead", "unconscious", "petrified"]);

/**
 * The conditions that remove Reactions and that `loseOne` reduces to one lost Reaction: Incapacitated, and those that override it
 * (dnd5e puts Incapacitated as a separate "rider"; if it is already there, the Stunned or Paralyzed effect arrives alone).
 */
export const SOFT_STOPS = Object.freeze(["incapacitated", "stunned", "paralyzed"]);

/**
 * Can the creature not react?
 * @param {{statuses?: Iterable<string>, blocked?: boolean, loseOne?: boolean}} state  `blocked`: a `noReactions` effect targets it.
 */
export function cannotReact({ statuses=[], blocked=false, loseOne=false }={}) {
  const has = new Set(statuses);
  if ( HARD_STOPS.some(s => has.has(s)) ) return true;
  const soft = blocked || SOFT_STOPS.some(s => has.has(s));
  return soft && !loseOne;
}

/**
 * Does a newly applied effect cost a Reaction to a `loseOne` creature? Yes if it carries a condition that removes Reactions
 * (`statuses`) or if it is a `noReactions` effect (`blocks`), and the creature is neither dead, nor unconscious, nor petrified.
 * @param {{statuses?: Iterable<string>, blocks?: boolean, actorStatuses?: Iterable<string>}} effect
 */
export function costsReaction({ statuses=[], blocks=false, actorStatuses=[] }={}) {
  const own = new Set(statuses);
  const actor = new Set(actorStatuses);
  if ( HARD_STOPS.some(s => actor.has(s) || own.has(s)) ) return false;
  return blocks || SOFT_STOPS.some(s => own.has(s));
}

/** The budget after a lost Reaction (never below 0), and whether there was one to lose. */
export function loseReaction(budget) {
  const before = Math.max(0, Number(budget?.reaction ?? 1) || 0);
  return { budget: { ...(budget ?? {}), reaction: Math.max(0, before - 1) }, lost: before > 0, left: Math.max(0, before - 1) };
}
