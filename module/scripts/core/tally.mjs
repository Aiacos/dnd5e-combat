/**
 * Compteur de sauvegardes répétées (SPEC §43.1) : « jusqu'à trois réussites ou trois échecs » — Contagion, Pétrification.
 * Les réussites et les échecs n'ont pas à se suivre ; seules comptent les sauvegardes REJOUÉES (pas celle du lancement).
 * Pur : l'état vit dans un flag de l'effet, le moteur l'écrit.
 */

/**
 * L'état du compteur après une sauvegarde.
 * @param {{successes?: number, failures?: number}|null} state   L'état d'avant (flag de l'effet), ou rien.
 * @param {boolean} success                                      La sauvegarde vient-elle d'être réussie ?
 * @param {{successes: number, failures: number}} rule           Les seuils.
 * @returns {{successes: number, failures: number, settled: boolean, outcome: "ended"|"settled"|null}}
 *   `ended` : le seuil de réussites est atteint, l'effet tombe ; `settled` : le seuil d'échecs est atteint, l'effet reste et
 *   plus aucune sauvegarde n'est rejouée.
 */
export function tallyAfter(state, success, rule) {
  const successes = (Number(state?.successes) || 0) + (success ? 1 : 0);
  const failures = (Number(state?.failures) || 0) + (success ? 0 : 1);
  const outcome = (successes >= rule.successes) ? "ended" : ((failures >= rule.failures) ? "settled" : null);
  return { successes, failures, settled: outcome === "settled", outcome };
}

/** Le compteur est-il clos (seuil d'échecs atteint) ? Plus de sauvegarde à rejouer. */
export const tallySettled = state => state?.settled === true;

/**
 * §495 (brique B15) : échelle d'états sur sauvegardes répétées — un poison qui empire à chaque échec (empoisonné → ralenti → paralysé)
 * et recule à chaque réussite. Le palier 0 est l'effet posé lui-même ; les paliers 1…N sont ceux de la règle (`stages`).
 * @param {number|null} level                 Le palier d'avant (0 : l'effet seul).
 * @param {boolean} success                   La sauvegarde vient-elle d'être réussie ?
 * @param {{count: number, onSuccess?: "down"|"end", natural20?: boolean, critEnds?: boolean}} rule
 *   `count` : le nombre de paliers ; `onSuccess` : « down » (par défaut) recule d'un palier — l'effet tombe s'il était au palier 0 —,
 *   « end » le fait tomber d'un coup ; `natural20` : la sauvegarde est un 20 naturel ; `critEnds` : un 20 naturel le fait tomber, même si le DD n'est pas atteint.
 * @returns {{level: number, outcome: "ended"|"up"|"down"|"same"}}
 */
export function stageAfter(level, success, { count, onSuccess="down", natural20=false, critEnds=false }) {
  const from = Math.max(0, Math.min(Number(level) || 0, count));
  if ( natural20 && critEnds ) return { level: from, outcome: "ended" };
  if ( !success ) return (from >= count) ? { level: from, outcome: "same" } : { level: from + 1, outcome: "up" };
  if ( (onSuccess === "end") || (from === 0) ) return { level: from, outcome: "ended" };
  return { level: from - 1, outcome: "down" };
}
