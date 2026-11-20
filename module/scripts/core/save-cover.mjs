/**
 * L'abri et les jets de sauvegarde de Dextérité (issue #183) — SRD 5.2, « Abri » : « abri partiel (+2 à la CA et aux jets de
 * sauvegarde de Dextérité), abri aux trois quarts (+5 à la CA et aux jets de sauvegarde de Dextérité) ». Fonctions pures.
 * Portée : une sauvegarde qui vise sa cible, sans zone — l'abri se juge alors depuis l'auteur, comme pour une attaque. Une zone se
 * jugerait depuis son point d'origine : laissé au MJ. `saveIgnoresCover` : « la cible ne bénéficie pas d'un abri partiel ni d'un
 * abri aux trois quarts pour cette sauvegarde » (Flamme sacrée).
 */

/** Cette sauvegarde reçoit-elle le bonus d'abri ? */
export function dexSaveTakesCover({ ability, area=false, ignores=false }) {
  return (ability === "dex") && !area && !ignores;
}

/** Le bonus que l'abri donne à la sauvegarde : 2, 5, ou 0 (pas d'abri ; un abri total n'a pas de bonus — la cible n'est pas visée). */
export function coverSaveBonus(cover) {
  return Number.isFinite(cover?.bonus) && (cover.bonus > 0) ? cover.bonus : 0;
}
