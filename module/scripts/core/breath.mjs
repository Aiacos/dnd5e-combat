/**
 * Le souffle d'une créature, et l'Avantage qu'un objet donne contre lui (clé de contenu `breathAdvantage` : Armure d'écailles de
 * dragon — « l'Avantage aux jets de sauvegarde contre le souffle des Dragons »). Un souffle se reconnaît à l'identifiant de sa
 * capacité : « fire-breath », « sleep-breath »… (« hold-breath », retenir son souffle, n'en est pas un). Fonctions pures.
 */

/** Cet identifiant de capacité est-il celui d'un souffle ? */
export function isBreathWeapon(identifier) {
  return (typeof identifier === "string") && /-breath$/.test(identifier) && (identifier !== "hold-breath");
}

/** La règle vaut-elle contre une créature de ce type ? */
export function breathAdvantageHolds(rule, creatureType) {
  return !!creatureType && Array.isArray(rule?.types) && rule.types.includes(creatureType);
}
