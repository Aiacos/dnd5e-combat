/**
 * §526 (issue #255) : les états « cavaliers » d'un effet d'item. dnd5e crée chaque état que l'effet demande en cavalier
 * (`system.rider.statuses`) comme un effet À PART, sans origine, qui survit à la fin de l'effet (data/abstract/active-effect-data-model.mjs,
 * `collectRiders`) : le Dard du pseudodragon laissait la cible Inconsciente une fois le poison parti, un « Frightened » d'une activité
 * la laissait Effrayée. Un état de condition demandé en cavalier devient un état de l'effet lui-même (avec ceux qu'il implique :
 * Inconscient → Neutralisé), et finit donc avec lui. À terre reste un cavalier à part : se réveiller ne relève pas. Pur.
 */

/** Les cavaliers qui restent à part, quoi qu'il arrive à l'effet qui les a posés. */
export const KEPT_RIDERS = Object.freeze(["prone"]);

/**
 * @param {object} o
 * @param {string[]} [o.statuses]    Les états de l'effet.
 * @param {string[]} [o.riders]      Les états qu'il demande en cavaliers.
 * @param {string[]} [o.conditions]  Les états qui sont des conditions (CONFIG.DND5E.conditionTypes).
 * @param {Record<string, string[]>} [o.implied]  Ce qu'implique chaque état (Inconscient → Neutralisé).
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
