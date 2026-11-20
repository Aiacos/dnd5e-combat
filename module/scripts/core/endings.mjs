/**
 * §258 : fins génériques d'un sort ou d'un effet (`endsWhen`, audit CAT / CPR du 2026-10-28) — ce qui décide, sans Foundry :
 *  - `armor` : le porteur enfile une armure (« any » : Armure du mage) ou une armure lourde (« heavy » : Rage) ;
 *  - `apart` : le porteur et le lanceur sont séparés de plus de la distance (Lien de garde : 18 m ; Duel forcé : 9 m à la fin du tour
 *    du lanceur) ;
 *  - `zeroHp` : le porteur ou le lanceur tombe à 0 PV (Lien de garde) ;
 *  - `unaffected` : l'utilisation n'a affecté personne (toutes les sauvegardes réussies, aucun coup au but) — la concentration tombe,
 *    le sort n'a plus rien à tenir (Immobilisation de personne, Bannissement…). Confort de table, réglage de monde.
 *
 *  - §495 `healedByMagic` : le porteur reçoit un soin magique (« jusqu'à ce qu'elle reçoive des soins magiques »).
 *
 * Pur : aucune dépendance à Foundry.
 */

import { isMagicalUse } from "./antimagic.mjs";

/** Les poids d'armure de dnd5e (`system.type.value` d'un équipement), du plus léger au plus lourd. */
export const ARMOR_WEIGHTS = Object.freeze(["light", "medium", "heavy"]);

/** Une armure de ce poids, qu'on vient d'enfiler, met-elle fin à l'effet ? `rule` : "any" ou "heavy". */
export function armorEnds(rule, weight) {
  if ( !ARMOR_WEIGHTS.includes(weight) ) return false;
  if ( rule === "any" ) return true;
  return (rule === "heavy") && (weight === "heavy");
}

/** Deux créatures séparées de `distance` (dans l'unité de la limite) le sont-elles de plus que `limit` ? Inconnue : non. */
export function tooFarApart(distance, limit) {
  return Number.isFinite(distance) && Number.isFinite(limit) && (distance > limit + 1e-6);
}

/**
 * L'utilisation résolue n'a-t-elle affecté personne ? Les cibles que l'action ne pouvait pas affecter (`unaffected` : type, immunité)
 * ne comptent pas.
 *  - "failedSave" : aucune cible n'a raté sa sauvegarde (une sauvegarde ratée d'office compte comme ratée) ;
 *  - "noHits" : aucune attaque n'a touché ;
 *  - "noTargets" : aucune cible affectable.
 * Une résolution sans sauvegarde jugée (en attente) n'a rien décidé : non.
 * @param {{targets: object[], plan?: object}} resolution
 * @param {"failedSave"|"noHits"|"noTargets"} condition
 */
export function nobodyAffected(resolution, condition) {
  const targets = (resolution?.targets ?? []).filter(t => !t.unaffected);
  if ( condition === "noTargets" ) return !targets.length;
  if ( !targets.length ) return true;
  if ( condition === "noHits" ) return targets.every(t => t.hit === false);
  if ( condition === "failedSave" ) {
    if ( targets.some(t => !t.save) ) return false;
    return targets.every(t => t.save.success === true);
  }
  return false;
}

/**
 * §275 : seule l'utilisation d'origine dit si le sort a « affecté » quelqu'un. Une sauvegarde répétée (`resave` : Malédiction, début de
 * tour), le rejeu d'une zone (`areaTick`) ou une relance sous concentration (`recast`) n'en décide rien — sinon une sauvegarde réussie
 * au rejeu ferait tomber la concentration de tout le sort (Malédiction réussie : la malédiction disparaissait ; Immobilisation sur deux
 * cibles : la seconde libérée avec la première). `flags` : les drapeaux du moteur sur le message d'utilisation.
 */
export function isReplayUsage(flags) {
  return !!(flags?.resave || flags?.areaTick || flags?.recast);
}

/**
 * §495 : ces PV appliqués sont-ils un soin magique ? Un soin (montant négatif) venu d'une utilisation magique — un sort lancé, une
 * activité d'objet magique, une capacité que le contenu dit `magical` (core/antimagic.mjs `isMagicalUse`) — ou d'une potion. Un soin
 * dont on ne connaît pas la source (PV changés à la main, dé de vie, repos) n'en est pas un.
 * @param {number} amount   Le montant appliqué par dnd5e (négatif : un soin).
 * @param {{spellCast?: boolean, item?: object, activityType?: string, magical?: boolean}|null} use   comme pour isMagicalUse.
 */
export function healsMagically(amount, use) {
  if ( !(Number(amount) < 0) || !use ) return false;
  if ( isMagicalUse(use) ) return true;
  return (use.item?.type === "consumable") && (use.item?.subtype === "potion");
}
