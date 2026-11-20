/**
 * M8 (SPEC §18.13) : la Régénération d'un acteur vue depuis Foundry — l'item (contenu `regeneration`, par identifiant), son
 * activité de soin, ce que dit le texte anglais d'origine — et la marque « coupée » posée par les dégâts qui l'arrêtent.
 */

import { MODULE_ID } from "../constants.mjs";
import { readRegeneration, resolveRegeneration } from "../core/regeneration.mjs";
import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";
import { inSunlight } from "./illumination.mjs";
// §484 : l'eau courante — une région ou une scène marquée (B05).
import { inRunningWater } from "./running-water.mjs";
// B09 (§488) : un objet porté qui suspend la Régénération (collier).
import { suspendedBy } from "./form-lock.mjs";

/**
 * B04 : `regeneration: true` (le texte anglais seul) ou la forme déclarée, qui l'emporte clé par clé (core/regeneration.mjs). Sans
 * activité de soin, `amount` déclaré suffit. B09 : null tant qu'un objet porté la suspend.
 * @returns {{item: Item5e, activity: Activity|null, amount: string|null, needsHp: boolean, stoppedBy: string[], silveredBy: string[],
 *   stoppedByItems: string[], stoppedWhile: string[], survivesZero: boolean, critical: boolean}|null}
 */
export function regenerationOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const declared = contentOf(item).entry?.regeneration;
    if ( (declared !== true) && !(declared && (typeof declared === "object")) ) continue;
    const activity = item.system.activities?.find(a => (a.type === "heal") && a.healing?.formula) ?? null;
    const regeneration = resolveRegeneration(declared, readRegeneration(englishDescription(item)));
    if ( !activity && !regeneration.amount ) continue;
    // B09 (§488) : tant qu'un objet porté la suspend (`suspends: ["regeneration"]`), la créature ne se régénère pas — et meurt à 0 PV.
    if ( suspendedBy(actor, "regeneration") ) return null;
    return { item, activity, ...regeneration };
  }
  return null;
}

/**
 * B04 : la créature est-elle là où son trait ne fonctionne pas (`stoppedWhile`) ? `sunlight` : la lumière du jour l'éclaire
 * (adapter/illumination.mjs, `inSunlight`) ; `runningWater` : une région ou une scène marquée « eau courante » (adapter/running-water.mjs, §484).
 * @returns {string[]}  Les lieux qui la retiennent.
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

/** L'identifiant (`system.identifier`) de l'objet des dégâts — message de dégâts de dnd5e (`options.originatingMessage`) —, ou null. */
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

/** Le soin de la Régénération : la formule de l'activité, un jet dans le chat, puis les PV rendus par le système. */
export async function regenerate(actor, regeneration) {
  const { activity, item, amount } = regeneration;
  const formula = amount ?? activity.healing.formula;
  const roll = await new Roll(formula, activity?.getRollData() ?? actor.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: item.name });
  await actor.applyDamage([{ value: roll.total, type: "healing" }]);
  return roll.total;
}
