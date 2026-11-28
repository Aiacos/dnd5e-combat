/**
 * B09 (§488): the form lock carried by an object (`formLock: { worn: true }`) and the traits a worn object suspends
 * (`suspends`), seen from Foundry. The pure rule: core/form-lock.mjs; what is played (refusals, steps, notices):
 * runtime/form-lock.mjs.
 */

import { isWorn, isFormAttempt, wornFormLock } from "../core/form-lock.mjs";
import { contentOf, declaresKey, identifierOf } from "./content.mjs";
import { formChangeOf } from "./coven.mjs";
import { originItemOf } from "./facts.mjs";

/** Is the object worn: equipped if it can be equipped, otherwise present on the sheet (a feature that represents the object). */
export const wornItem = item => !!item && isWorn({ equippable: ("equipped" in (item.system ?? {})), equipped: item.system?.equipped });

/** The form lock this actor carries — `{ item, onAttempt, forms }` —, or null. */
export function wornFormLockOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    if ( !declaresKey(item, "formLock") || !wornItem(item) ) continue;
    const lock = wornFormLock(contentOf(item).entry);
    if ( lock ) return { item, ...lock };
  }
  return null;
}

/**
 * Is using this activity an attempt to change form that a worn object forbids? Returns the lock, or null.
 * A "transform" activity, a declared form change (`changesForm`), or the activity of an item named in `forms`.
 */
export function formAttemptLock(activity) {
  const lock = wornFormLockOf(activity?.actor);
  if ( !lock || (activity.item === lock.item) ) return null;
  const attempt = isFormAttempt({ type: activity.type, identifier: identifierOf(activity.item).id, declaredChange: !!formChangeOf(activity) }, lock.forms);
  return attempt ? lock : null;
}

/**
 * Is turning this effect on an attempt to change form? Yes when it comes from an item named in `forms` (a sheet's forms
 * made of effects to turn on by hand) and the actor carries the lock. Returns `{ lock, actor, item }`, or null.
 */
export function effectAttemptLock(effect) {
  const parent = effect?.parent ?? null;
  const item = (parent?.documentName === "Item") ? parent : originItemOf(effect);
  const actor = item?.actor ?? ((parent?.documentName === "Actor") ? parent : null);
  const lock = wornFormLockOf(actor);
  if ( !lock || !item || (item === lock.item) ) return null;
  return lock.forms.includes(identifierOf(item).id) ? { lock, actor, item } : null;
}

/** The worn object that suspends this trait (`suspends`, an entry key: "regeneration") on this actor, or null. */
export function suspendedBy(actor, key) {
  for ( const item of actor?.items ?? [] ) {
    if ( !declaresKey(item, "suspends") || !wornItem(item) ) continue;
    if ( (contentOf(item).entry?.suspends ?? []).includes(key) ) return item;
  }
  return null;
}
