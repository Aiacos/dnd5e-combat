/**
 * Limites d'utilisation d'une activité que dnd5e ne contrôle pas (SPEC §16.40, clé `usageLimits` de core/content.mjs) :
 *  - `oncePerTurn` : « une fois à chacun de vos tours » — en combat, seulement à son tour, et une fois ;
 *  - `whenEmpty` : seulement quand l'item de cet identifiant n'a plus d'utilisation (Regain sauvage : « si vous n'avez plus
 *    d'utilisation de Forme sauvage ») ;
 *  - `lowestSlot` : l'emplacement de sort dépensé est d'office le plus bas disponible, sans fenêtre ;
 *  - `unmoved` : seulement si l'on ne s'est pas déplacé ce tour (Visée stable, §20) — en combat ;
 *  - `whileEffect` (§486) : seulement sous un effet (identifiant d'item dont l'effet est porté, ou id d'effet ; une liste = l'un
 *    d'eux) — « Griffes (requiert Modification d'apparence) », armes d'une seule forme ; `unlessEffect` : seulement hors de ces
 *    effets (l'arme de la forme humanoïde). En combat ou non.
 * Fonctions pures.
 */

/**
 * Ce qui cloche, en mode souple (le joueur peut passer outre).
 * @param {{oncePerTurn?: boolean, whenEmpty?: string, unmoved?: boolean}} rule
 * @param {{inCombat: boolean, ownTurn: boolean, usedThisTurn: boolean, remaining: number|null, moved?: boolean,
 *   underEffect?: boolean|null, barredByEffect?: boolean|null}} state  `underEffect` : l'un des effets `whileEffect` est porté ;
 *   `barredByEffect` : l'un des effets `unlessEffect` est porté.
 * @returns {string[]}  « notOwnTurn », « oncePerTurn », « notEmpty », « moved », « needsEffect », « barredByEffect ».
 */
export function usageLimitIssues(rule, { inCombat, ownTurn, usedThisTurn, remaining, moved=false, underEffect=null, barredByEffect=null }) {
  const issues = [];
  if ( rule?.oncePerTurn && inCombat ) {
    if ( !ownTurn ) issues.push("notOwnTurn");
    else if ( usedThisTurn ) issues.push("oncePerTurn");
  }
  if ( rule?.whenEmpty && Number.isFinite(remaining) && (remaining > 0) ) issues.push("notEmpty");
  if ( rule?.unmoved && inCombat && moved ) issues.push("moved");
  if ( rule?.whileEffect && (underEffect === false) ) issues.push("needsEffect");
  if ( rule?.unlessEffect && (barredByEffect === true) ) issues.push("barredByEffect");
  // `automatic` : le moteur joue déjà cette activité de lui-même (un déclencheur du même item) ; la lancer en plus à la main la jouerait
  // deux fois (Marteau de tonnerre, Guide 3.0.0 : « Thunderclap »). Refus forçable, en combat ou non.
  if ( rule?.automatic ) issues.push("automatic");
  return issues;
}

/**
 * §16.40 : le plus bas niveau d'emplacement de sort encore disponible, ou null. Pour une activité où le niveau ne change rien
 * (Regain de Forme sauvage : « en dépensant un emplacement de sort ») : dépenser plus haut, c'est gaspiller.
 * @param {Record<number, number>} available  Emplacements restants par niveau (1 à 9).
 */
export function lowestSlotLevel(available) {
  for ( let level = 1; level <= 9; level++ ) if ( (Number(available[level]) || 0) > 0 ) return level;
  return null;
}

/** §486 : `whileEffect` / `unlessEffect` en liste (une chaîne seule = une liste d'un). */
export const effectRefs = value => (value == null) ? [] : [value].flat().filter(v => (typeof v === "string") && v);

/**
 * Core#98 : une aptitude dont on ne prend qu'une option par Rage (Rage du prédateur : « quand vous activez votre Rage, choisissez
 * l'une des options suivantes ») — en Rage, une option déjà prise (une copie d'effet de l'item sur le barbare) refuse la suivante.
 * Hors Rage, rien à refuser ici (l'option n'aurait pas d'effet : `duringRage`).
 * @param {{oneOption?: boolean, raging: boolean, taken: number}} state  `taken` : les effets d'option de l'item déjà portés.
 */
export const secondRageOption = ({ oneOption=false, raging=false, taken=0 }={}) => (oneOption === true) && !!raging && (Number(taken) > 0);
