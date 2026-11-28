/**
 * The uses of an item (dnd5e's `system.uses`) spent by the engine outside an activity: a Reaction paid for by another
 * item, a Smite, a feat that works once per rest…
 */

import { levelHidden } from "./level-gate.mjs";

/**
 * §438: what keeps the count of an activity that is spent — the activity if it has its own uses (Manual 2.2.0: Dreadful
 * Strike, `activityUses`), otherwise the item whose uses it consumes (Manual 3.0.0: `itemUses` without a target = its item; a
 * target = that item of the actor). `{ left, spend() }`, or null.
 */
export function usesHolderOf(activity) {
  if ( !activity ) return null;
  const own = activity.uses;
  if ( own && (own.max !== "") && (own.max != null) && Number.isFinite(Number(own.value)) ) {
    return { left: Math.max(0, Number(own.value) || 0), spend: () => activity.update({ "uses.spent": (Number(own.spent) || 0) + 1 }) };
  }
  const target = (activity.consumption?.targets ?? []).find(t => t.type === "itemUses");
  const item = target ? (target.target ? activity.actor?.items?.get(target.target) : activity.item) : null;
  if ( !item?.system?.uses ) return null;
  const n = Number(target.value) || 1;
  return { left: Math.max(0, Math.floor((Number(item.system.uses.value) || 0) / n)), spend: () => spendItemUses(item, n) };
}

/** §438: the first activity of the list that the item carries and that the sheet shows at this level (`ask.uses`), or null. */
export function shownActivityOf(item, ids) {
  for ( const id of [ids].flat() ) {
    const a = item?.system?.activities?.get?.(id);
    if ( a && !levelHidden(a) ) return a;
  }
  return null;
}

/** Spend `n` uses of the item (`system.uses.spent`). Returns the update's promise. */
export function spendItemUses(item, n=1) {
  return item.update({ "system.uses.spent": (Number(item.system.uses?.spent) || 0) + n });
}
