/**
 * B09 (§488) : le verrou de forme porté par un objet (`formLock: { worn: true }`) et les traits qu'un objet porté suspend
 * (`suspends`), vus depuis Foundry. La règle pure : core/form-lock.mjs ; ce qui se joue (refus, étapes, avis) : runtime/form-lock.mjs.
 */

import { isWorn, isFormAttempt, wornFormLock } from "../core/form-lock.mjs";
import { contentOf, declaresKey, identifierOf } from "./content.mjs";
import { formChangeOf } from "./coven.mjs";
import { originItemOf } from "./facts.mjs";

/** L'objet est-il porté : équipé s'il s'équipe, sinon présent sur la fiche (une capacité qui représente l'objet). */
export const wornItem = item => !!item && isWorn({ equippable: ("equipped" in (item.system ?? {})), equipped: item.system?.equipped });

/** Le verrou de forme que porte cet acteur — `{ item, onAttempt, forms }` —, ou null. */
export function wornFormLockOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    if ( !declaresKey(item, "formLock") || !wornItem(item) ) continue;
    const lock = wornFormLock(contentOf(item).entry);
    if ( lock ) return { item, ...lock };
  }
  return null;
}

/**
 * L'utilisation de cette activité est-elle une tentative de changer de forme qu'un objet porté interdit ? Rend le verrou, ou null.
 * Une activité « transform », un changement de forme déclaré (`changesForm`), ou l'activité d'un item nommé dans `forms`.
 */
export function formAttemptLock(activity) {
  const lock = wornFormLockOf(activity?.actor);
  if ( !lock || (activity.item === lock.item) ) return null;
  const attempt = isFormAttempt({ type: activity.type, identifier: identifierOf(activity.item).id, declaredChange: !!formChangeOf(activity) }, lock.forms);
  return attempt ? lock : null;
}

/**
 * Allumer cet effet est-il une tentative de changer de forme ? Oui quand il vient d'un item nommé dans `forms` (les formes d'une fiche
 * faites d'effets à allumer à la main) et que l'acteur porte le verrou. Rend `{ lock, actor, item }`, ou null.
 */
export function effectAttemptLock(effect) {
  const parent = effect?.parent ?? null;
  const item = (parent?.documentName === "Item") ? parent : originItemOf(effect);
  const actor = item?.actor ?? ((parent?.documentName === "Actor") ? parent : null);
  const lock = wornFormLockOf(actor);
  if ( !lock || !item || (item === lock.item) ) return null;
  return lock.forms.includes(identifierOf(item).id) ? { lock, actor, item } : null;
}

/** L'objet porté qui suspend ce trait (`suspends`, une clé d'entrée : « regeneration ») chez cet acteur, ou null. */
export function suspendedBy(actor, key) {
  for ( const item of actor?.items ?? [] ) {
    if ( !declaresKey(item, "suspends") || !wornItem(item) ) continue;
    if ( (contentOf(item).entry?.suspends ?? []).includes(key) ) return item;
  }
  return null;
}
