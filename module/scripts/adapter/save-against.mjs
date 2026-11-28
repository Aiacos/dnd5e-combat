/**
 * `saveDisadvantageAgainst` (core/eligibility.mjs): a carried object — equipped, and attuned if it requires it — that gives
 * Disadvantage on saves imposed by a creature of a subtype (Demon Armor).
 */

import { saveDisadvantageAgainstHolds } from "../core/eligibility.mjs";
import { contentOf } from "./content.mjs";

const carried = item => (item.system?.equipped !== false) && ((item.system?.attunement !== "required") || (item.system?.attuned === true));

/** The object carried by `actor` that gives them Disadvantage against a save imposed by `source`, or null. */
export function saveDisadvantageAgainst(actor, source) {
  const subtype = source?.system?.details?.type?.subtype;
  if ( !subtype || !actor || (actor === source) ) return null;
  return Array.from(actor.items ?? []).find(item => carried(item)
    && saveDisadvantageAgainstHolds(contentOf(item).entry?.saveDisadvantageAgainst, subtype)) ?? null;
}
