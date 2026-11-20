/**
 * §501 (brique B21) — « si elle devait perdre ses réactions, elle n'en perd qu'une » : `reactions: { perRound, loseOne: true }`. Règles
 * pures. Ce qui retire d'ordinaire les réactions (état Neutralisé, effet d'un item `noReactions`) ne bloque plus la créature : chaque
 * nouvel effet de ce genre lui ôte une seule réaction du round. Morte, inconsciente ou pétrifiée, elle ne réagit toujours pas.
 */

/** Les états qui empêchent toujours de réagir, même avec `loseOne`. */
export const HARD_STOPS = Object.freeze(["dead", "unconscious", "petrified"]);

/**
 * Les états qui retirent les réactions et que `loseOne` réduit à une réaction perdue : Neutralisé, et ceux qui l'emportent (dnd5e pose
 * Neutralisé en « rider » à part ; s'il est déjà là, l'effet d'Étourdi ou de Paralysé arrive seul).
 */
export const SOFT_STOPS = Object.freeze(["incapacitated", "stunned", "paralyzed"]);

/**
 * La créature ne peut-elle pas réagir ?
 * @param {{statuses?: Iterable<string>, blocked?: boolean, loseOne?: boolean}} state  `blocked` : un effet `noReactions` la vise.
 */
export function cannotReact({ statuses=[], blocked=false, loseOne=false }={}) {
  const has = new Set(statuses);
  if ( HARD_STOPS.some(s => has.has(s)) ) return true;
  const soft = blocked || SOFT_STOPS.some(s => has.has(s));
  return soft && !loseOne;
}

/**
 * Un effet qui vient d'être posé coûte-t-il une réaction à une créature `loseOne` ? Oui s'il porte un état qui retire les réactions
 * (`statuses`) ou s'il est un effet `noReactions` (`blocks`), et qu'elle n'est ni morte, ni inconsciente, ni pétrifiée.
 * @param {{statuses?: Iterable<string>, blocks?: boolean, actorStatuses?: Iterable<string>}} effect
 */
export function costsReaction({ statuses=[], blocks=false, actorStatuses=[] }={}) {
  const own = new Set(statuses);
  const actor = new Set(actorStatuses);
  if ( HARD_STOPS.some(s => actor.has(s) || own.has(s)) ) return false;
  return blocks || SOFT_STOPS.some(s => own.has(s));
}

/** Le budget après une réaction perdue (jamais sous 0), et s'il y en avait une à perdre. */
export function loseReaction(budget) {
  const before = Math.max(0, Number(budget?.reaction ?? 1) || 0);
  return { budget: { ...(budget ?? {}), reaction: Math.max(0, before - 1) }, lost: before > 0, left: Math.max(0, before - 1) };
}
