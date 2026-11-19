/**
 * L'ouïe (§62) : où est une créature qu'on ne voit pas ? Règle 2024 : on sait où est une créature invisible ou dans une zone à
 * visibilité nulle — on l'entend —, sauf si elle est cachée (Se cacher réussi : sa position est inconnue tant qu'on ne l'a pas
 * trouvée). On peut alors l'attaquer, au désavantage, mais pas la viser par un effet qui demande de la voir. Pas de portée : seuls
 * les murs qui arrêtent le son, la surdité de l'observateur et le silence de la cible comptent. Fonctions pures.
 */

/**
 * L'observateur entend-il la cible ?
 * @param {object} state
 * @param {boolean} state.deafened      L'observateur est Assourdi.
 * @param {boolean} state.hidden        La cible est cachée (Furtivité du moteur).
 * @param {boolean} state.silent        La cible ne fait aucun bruit (morte).
 * @param {boolean} state.soundBlocked  Un mur qui arrête le son les sépare.
 * @param {boolean} state.outOfRange    Réglage `hearingRange` (règle maison) : la cible est au-delà de la portée d'ouïe.
 */
export function hears({ deafened=false, hidden=false, silent=false, soundBlocked=false, outOfRange=false }) {
  return !deafened && !hidden && !silent && !soundBlocked && !outOfRange;
}

/**
 * Réglage `hearingRange` : la portée d'ouïe d'un observateur. Les règles n'en donnent aucune — c'est une règle maison, éteinte par
 * défaut. `value` : ce que donne la formule du réglage pour lui ; null — sans portée — si le réglage est vide ou si la formule ne
 * donne pas un nombre positif ou nul.
 * @param {*} value
 * @returns {number|null}
 */
export function hearingRange(value) {
  return ((typeof value === "number") && Number.isFinite(value) && (value >= 0)) ? value : null;
}

/** La cible est-elle au-delà de la portée d'ouïe ? `range` null : il n'y a pas de portée. */
export function beyondHearing(distance, range) {
  return (range !== null) && (range !== undefined) && !(distance <= range);
}

/**
 * La position de la cible est-elle inconnue de l'observateur ? Cachée et ni vue ni perçue autrement : on ne peut pas la viser.
 * @param {{hidden: boolean, sees: boolean|null}} state  `sees` : null quand la vision ne peut pas trancher (on laisse faire).
 */
export function locationUnknown({ hidden=false, sees=null }) {
  return hidden && (sees === false);
}
