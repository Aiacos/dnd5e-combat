/**
 * Un soin qui relève aussi les PV maximum d'autant (clé de contenu `healRaisesMax`, avec `effectsFirst`) : Festin des héros — « ses PV
 * maximum augmentent de 2d10, et elle gagne autant de PV ». Le montant tiré s'ajoute aux changements de l'effet posé avant le soin.
 * Fonctions pures.
 */

/** Le total des parts de soin d'un jet (`[{ type, value }]`). */
export function healingTotal(rolled) {
  return (rolled ?? []).filter(d => d?.type === "healing").reduce((n, d) => n + (Number(d.value) || 0), 0);
}

/** Les changements d'un effet, avec la hausse des PV maximum (`system.attributes.hp.tempmax`) — remplacée si elle y était déjà. */
export function withMaxRaise(changes, amount) {
  const key = "system.attributes.hp.tempmax";
  return [...(changes ?? []).filter(c => c.key !== key), { key, type: "add", value: amount, priority: null }];
}
