/**
 * M8 (SPEC §18.13): an actor's Regeneration seen from Foundry — the item (content `regeneration`, by identifier), its
 * heal activity, what the original English text says — and the "cut" mark set by the damage that stops it.
 */

import { MODULE_ID } from "../constants.mjs";
import { readRegeneration, resolveRegeneration } from "../core/regeneration.mjs";
import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";
import { inSunlight } from "./illumination.mjs";
// §484: running water — a marked region or scene (B05).
import { inRunningWater } from "./running-water.mjs";
// B09 (§488): a carried object that suspends Regeneration (necklace).
import { suspendedBy } from "./form-lock.mjs";

/**
 * B04: `regeneration: true` (the English text alone) or the declared form, which wins key by key (core/regeneration.mjs).
 * Without a heal activity, a declared `amount` is enough. B09: null as long as a carried object suspends it.
 * @returns {{item: Item5e, activity: Activity|null, amount: string|null, needsHp: boolean, stoppedBy: string[],
 *   silveredBy: string[],
 *   stoppedByItems: string[], stoppedWhile: string[], survivesZero: boolean, critical: boolean}|null}
 */
export function regenerationOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const declared = contentOf(item).entry?.regeneration;
    if ( (declared !== true) && !(declared && (typeof declared === "object")) ) continue;
    const activity = item.system.activities?.find(a => (a.type === "heal") && a.healing?.formula) ?? null;
    const regeneration = resolveRegeneration(declared, readRegeneration(englishDescription(item)));
    if ( !activity && !regeneration.amount ) continue;
    // B09 (§488): while a carried object suspends it (`suspends: ["regeneration"]`), no regeneration — and death at 0 HP.
    if ( suspendedBy(actor, "regeneration") ) return null;
    return { item, activity, ...regeneration };
  }
  return null;
}

/**
 * B04: is the creature where its trait does not work (`stoppedWhile`)? `sunlight`: daylight lights it
 * (adapter/illumination.mjs, `inSunlight`); `runningWater`: a region or scene marked "running water"
 * (adapter/running-water.mjs, §484).
 * @returns {string[]}  The places that hold it back.
 */
export function heldBy(token, regeneration) {
  const doc = token?.document ?? token;
  const held = [];
  for ( const where of regeneration?.stoppedWhile ?? [] ) {
    if ( (where === "sunlight") && inSunlight(doc) ) held.push(where);
    else if ( (where === "runningWater") && inRunningWater(doc) ) held.push(where);
  }
  return held;
}

/** The identifier (`system.identifier`) of the damage's item — dnd5e damage message (`options.originatingMessage`) —, or null. */
export function damageItemIdentifier(options) {
  const message = options?.originatingMessage ?? options?.origin;
  const item = message?.getAssociatedActivity?.()?.item ?? message?.getAssociatedItem?.() ?? null;
  return item?.system?.identifier ?? null;
}

export const isStopped = actor => !!actor?.getFlag(MODULE_ID, "regenerationStopped");

export async function markStopped(actor, types) {
  if ( !isStopped(actor) ) await actor.setFlag(MODULE_ID, "regenerationStopped", types);
}

export async function clearStopped(actor) {
  if ( isStopped(actor) ) await actor.unsetFlag(MODULE_ID, "regenerationStopped");
}

/** Regeneration's heal: the activity's formula, a roll in the chat, then the HP restored by the system. */
export async function regenerate(actor, regeneration) {
  const { activity, item, amount } = regeneration;
  const formula = amount ?? activity.healing.formula;
  const roll = await new Roll(formula, activity?.getRollData() ?? actor.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: item.name });
  await actor.applyDamage([{ value: roll.total, type: "healing" }]);
  return roll.total;
}
