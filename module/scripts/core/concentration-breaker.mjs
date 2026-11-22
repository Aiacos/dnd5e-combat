/**
 * §133 : le briseur de concentration — la créature concentrée qu'on blesse a le Désavantage à son prochain jet de concentration.
 * Fonction pure.
 *
 * `concentrationBreaker: true` vaut pour le porteur : tout dégât qu'il inflige compte (un don, Tueur de mages). `"item"` vaut
 * pour l'objet seul : le dégât doit venir d'une de ses activités, et l'objet être prêt à servir (équipé, harmonisé s'il le
 * demande) — une arme magique qui ne doit rien donner aux autres attaques de son porteur.
 *
 * @param {object} o
 * @param {Array<true|"item"|undefined>} [o.owned]  Ce que déclarent les objets du porteur.
 * @param {true|"item"|undefined} [o.item]          Ce que déclare l'objet dont l'activité a infligé le dégât.
 * @param {boolean} [o.itemReady]                   Cet objet est-il équipé, et harmonisé s'il le demande ?
 * @returns {boolean}
 */
export function breaksConcentration({ owned=[], item, itemReady=true }={}) {
  if ( owned.some(v => v === true) ) return true;
  return (item === "item") && (itemReady === true);
}
