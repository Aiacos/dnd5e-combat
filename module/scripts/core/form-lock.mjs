/**
 * B09 (§488) : le verrou de forme porté par un objet et les traits qu'un objet porté suspend. Fonctions pures, aucune dépendance à Foundry.
 *
 * - `formLock: true` (§403) : la zone qui dure de l'item interdit d'y changer de forme (Rayon de lune) — adapter/areas.mjs.
 * - `formLock: { worn: true, onAttempt?, forms? }` : tant que l'objet est porté, son porteur ne peut pas changer de forme ; chaque
 *   tentative est refusée (forçable) et lui inflige les étapes `onAttempt` (des dégâts, `to: "bearer"`). Une tentative : une activité
 *   « transform » de dnd5e, l'activité d'un changement de forme déclaré (`changesForm`), toute activité d'un item dont l'identifiant
 *   est dans `forms`, ou l'activation à la main d'un effet porté par un tel item (les formes d'une fiche faites d'effets à allumer).
 * - `suspends: [clé, …]` : tant que l'objet est porté, ces traits de son porteur ne fonctionnent pas (une clé d'entrée : `regeneration`).
 */

/** Les traits qu'un objet porté sait suspendre : ceux que le moteur relit en tenant compte de `suspends` (adapter/form-lock.mjs). */
export const SUSPENDABLE = Object.freeze(["regeneration"]);

/** Les erreurs de `formLock` (vide = valide). `damageTypes` : les types de dégâts connus, ou null pour ne pas les vérifier. */
export function validateFormLock(value, damageTypes=null) {
  if ( value === true ) return [];
  if ( !value || (typeof value !== "object") || Array.isArray(value) ) return ["formLock: true (zone) or { worn: true, onAttempt?, forms? }"];
  const errors = [];
  for ( const key of Object.keys(value) ) if ( !["worn", "onAttempt", "forms"].includes(key) ) errors.push(`formLock.${key}: unknown key`);
  if ( value.worn !== true ) errors.push("formLock.worn: true (the only mode besides the zone's formLock: true)");
  if ( "forms" in value ) {
    const ok = Array.isArray(value.forms) && value.forms.length && value.forms.every(f => (typeof f === "string") && f.trim());
    if ( !ok ) errors.push("formLock.forms: non-empty list of item identifiers");
  }
  if ( "onAttempt" in value ) {
    if ( !Array.isArray(value.onAttempt) || !value.onAttempt.length ) errors.push("formLock.onAttempt: non-empty list of steps");
    else value.onAttempt.forEach((step, i) => {
      const at = `formLock.onAttempt[${i}]`;
      if ( !step || (typeof step !== "object") ) return errors.push(`${at}: a step is an object`);
      if ( step.type !== "damage" ) errors.push(`${at}.type: "damage" (the only step a worn form lock plays)`);
      if ( ("to" in step) && (step.to !== "bearer") ) errors.push(`${at}.to: "bearer" or absent`);
      for ( const key of Object.keys(step) ) if ( !["type", "to", "formula", "damageType", "activity"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
      if ( "activity" in step ) {
        if ( !/^[A-Za-z0-9]{16}$/.test(step.activity ?? "") ) errors.push(`${at}.activity: activity id (16 characters) expected`);
        return;
      }
      if ( (typeof step.formula !== "string") || !step.formula.trim() ) errors.push(`${at}.formula: formula required`);
      if ( (typeof step.damageType !== "string") || !step.damageType ) errors.push(`${at}.damageType: damage type required`);
      else if ( damageTypes && !damageTypes.includes(step.damageType) ) errors.push(`${at}.damageType: unknown "${step.damageType}"`);
    });
  }
  return errors;
}

/** Les erreurs de `suspends` (vide = valide). */
export function validateSuspends(value) {
  const ok = Array.isArray(value) && value.length && value.every(k => SUSPENDABLE.includes(k)) && (new Set(value).size === value.length);
  return ok ? [] : [`suspends: non-empty list among ${SUSPENDABLE.join(", ")}`];
}

/** Le verrou porté d'une entrée, normalisé — `{ onAttempt, forms }` —, ou null (pas de verrou, ou celui d'une zone). */
export function wornFormLock(entry) {
  const lock = entry?.formLock;
  if ( !lock || (lock === true) || (lock.worn !== true) ) return null;
  return { onAttempt: Array.isArray(lock.onAttempt) ? lock.onAttempt : [], forms: Array.isArray(lock.forms) ? lock.forms : [] };
}

/**
 * Un objet est-il « porté » ? Un objet qui s'équipe (arme, équipement, consommable…) l'est s'il est équipé ; un objet qui ne s'équipe
 * pas (une capacité de la fiche qui représente l'objet) l'est tant qu'il est sur la fiche.
 */
export const isWorn = ({ equippable, equipped }) => !equippable || (equipped === true);

/**
 * Une activité est-elle une tentative de changer de forme ? `type` : celui de l'activité ; `identifier` : celui de son item ;
 * `declaredChange` : l'item déclare `changesForm` pour cette activité ; `forms` : les identifiants que le verrou nomme.
 */
export function isFormAttempt({ type, identifier=null, declaredChange=false }, forms=[]) {
  if ( (type === "transform") || declaredChange ) return true;
  return !!identifier && forms.includes(identifier);
}
