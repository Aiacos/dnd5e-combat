/**
 * §133: the concentration breaker — the concentrating creature that is hurt has Disadvantage on its next Concentration check.
 * Pure function.
 *
 * `concentrationBreaker: true` applies to the bearer: any damage they deal counts (a feat, Mage Slayer). `"item"` applies
 * to the item alone: the damage must come from one of its activities, and the item must be ready for use (equipped, attuned if it
 * requires it) — a magic weapon must give nothing to the other attacks of its bearer.
 *
 * @param {object} o
 * @param {Array<true|"item"|undefined>} [o.owned]  What the bearer's items declare.
 * @param {true|"item"|undefined} [o.item]          What the item whose activity dealt the damage declares.
 * @param {boolean} [o.itemReady]                   Is this item equipped, and attuned if it requires it?
 * @returns {boolean}
 */
export function breaksConcentration({ owned=[], item, itemReady=true }={}) {
  if ( owned.some(v => v === true) ) return true;
  return (item === "item") && (itemReady === true);
}
