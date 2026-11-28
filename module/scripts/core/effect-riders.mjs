/**
 * §526 (issue #255): the "rider" conditions of an item effect. dnd5e creates each condition the effect asks for as a rider
 * (`system.rider.statuses`) as a SEPARATE effect, with no origin, which outlives the end of the effect
 * (data/abstract/active-effect-data-model.mjs, `collectRiders`): the pseudodragon's Sting left the target Unconscious
 * once the poison was gone, a "Frightened" from an activity left it Frightened. A condition requested as a rider becomes a
 * condition of the effect itself (with those it implies: Unconscious → Incapacitated), and so ends with it. Prone stays a
 * separate rider: waking up does not get one up. Pure.
 */

/** The riders that stay separate, whatever happens to the effect that applied them. */
export const KEPT_RIDERS = Object.freeze(["prone"]);

/**
 * @param {object} o
 * @param {string[]} [o.statuses]    The conditions of the effect.
 * @param {string[]} [o.riders]      The conditions it requests as riders.
 * @param {string[]} [o.conditions]  The conditions that are conditions (CONFIG.DND5E.conditionTypes).
 * @param {Record<string, string[]>} [o.implied]  What each condition implies (Unconscious → Incapacitated).
 * @returns {{statuses: string[], riders: string[], folded: string[]}}
 */
export function foldRiderStatuses({ statuses=[], riders=[], conditions=[], implied={} }={}) {
  const own = new Set(statuses);
  const kept = [];
  const folded = [];
  for ( const r of riders ) {
    if ( KEPT_RIDERS.includes(r) || !conditions.includes(r) ) { kept.push(r); continue; }
    folded.push(r);
    own.add(r);
    for ( const s of implied[r] ?? [] ) own.add(s);
  }
  return { statuses: [...own], riders: kept, folded };
}
