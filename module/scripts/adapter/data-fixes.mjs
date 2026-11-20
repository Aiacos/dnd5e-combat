/**
 * O1 (SPEC §335) : la correction de la donnée premium d'un objet (`dataFixes`, core/data-fixes.mjs) sur un document dnd5e.
 */
import { MODULE_ID } from "../constants.mjs";
import { dataFixPlan, planIsEmpty, castFixes } from "../core/data-fixes.mjs";
import { contentOf } from "./content.mjs";

/** Ce que l'item qui lance cette copie de sort déclare pour son activité « cast » (`spellFixes.<id d'activité>`), ou null. */
function spellFixesFor(item) {
  const cached = item.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item\.([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  const caster = m ? item.actor?.items?.get(m[1]) : null;
  return caster ? (contentOf(caster).entry?.spellFixes?.[m[2]] ?? null) : null;
}

/** Le plan de correction d'un item, ou `null` s'il n'y a rien à corriger. */
export function dataFixPlanOf(item) {
  if ( item?.documentName !== "Item" ) return null;
  // `spellFixes` : la copie d'un sort qu'une activité « cast » lance (`flags.dnd5e.cachedFor`) reçoit aussi ce que l'item qui la
  // lance déclare pour cette activité (Baguette de terreur : « Terreur (cône de 18 m) »).
  const fixes = castFixes(contentOf(item).entry?.dataFixes, spellFixesFor(item));
  if ( !fixes ) return null;
  const plan = dataFixPlan(item.toObject(), fixes);
  return planIsEmpty(plan) ? null : plan;
}

/** Applique le plan : champs de l'item, puis effets corrigés, puis effets créés (avec leur id). */
export async function applyDataFixes(item, plan) {
  const options = { [MODULE_ID]: { dataFix: true } };
  if ( Object.keys(plan.item).length ) await item.update(plan.item, options);
  if ( plan.effects.length ) await item.updateEmbeddedDocuments("ActiveEffect", plan.effects, options);
  if ( plan.create.length ) await item.createEmbeddedDocuments("ActiveEffect", plan.create, { ...options, keepId: true });
}
