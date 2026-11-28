/**
 * O1 (SPEC §335): the correction of an item's premium data (`dataFixes`, core/data-fixes.mjs) on a dnd5e document.
 */
import { MODULE_ID } from "../constants.mjs";
import { dataFixPlan, planIsEmpty, castFixes } from "../core/data-fixes.mjs";
import { contentOf } from "./content.mjs";

/** What the item that casts this spell copy declares for its "cast" activity (`spellFixes.<id d'activité>`), or null. */
function spellFixesFor(item) {
  const cached = item.flags?.dnd5e?.cachedFor;
  const m = (typeof cached === "string") ? cached.match(/Item\.([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  const caster = m ? item.actor?.items?.get(m[1]) : null;
  return caster ? (contentOf(caster).entry?.spellFixes?.[m[2]] ?? null) : null;
}

/** An item's correction plan, or `null` if there is nothing to fix. */
export function dataFixPlanOf(item) {
  if ( item?.documentName !== "Item" ) return null;
  // `spellFixes`: the copy of a spell that a "cast" activity casts (`flags.dnd5e.cachedFor`) also receives what the item that
  // casts it declares for that activity (Wand of Fear: "Fear (18 m Cone)").
  const fixes = castFixes(contentOf(item).entry?.dataFixes, spellFixesFor(item));
  if ( !fixes ) return null;
  const plan = dataFixPlan(item.toObject(), fixes);
  return planIsEmpty(plan) ? null : plan;
}

/** Applies the plan: item fields, then corrected effects, then created effects (with their id). */
export async function applyDataFixes(item, plan) {
  const options = { [MODULE_ID]: { dataFix: true } };
  if ( Object.keys(plan.item).length ) await item.update(plan.item, options);
  if ( plan.effects.length ) await item.updateEmbeddedDocuments("ActiveEffect", plan.effects, options);
  if ( plan.create.length ) await item.createEmbeddedDocuments("ActiveEffect", plan.create, { ...options, keepId: true });
}
