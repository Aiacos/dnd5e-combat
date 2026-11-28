import { describe, it, expect } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dataFixPlan, planIsEmpty } from "../module/scripts/core/data-fixes.mjs";

/** The spell data as dnd5e renders it on a sheet: each activity with `consumption.spellSlot` (true by default). */
const spell = (activities) => ({ system: { activities: Object.fromEntries(Object.entries(activities)
  .map(([id, spellSlot]) => [id, { _id: id, consumption: { spellSlot, targets: [] } }])) }, effects: [] });

const CASES = {
  "detect-thoughts": { cast: "cNjNJvq5tlzmAjzM", follow: "dnd5eactivity000" },
  "conjure-fey": { cast: "w2sWkRQ3xMVRf7g3", follow: "sKmRcy0IDp9aOuAt" },
  "guardian-of-faith": { cast: "dnd5eactivity000", follow: "dnd5eactivity100" },
  "flaming-sphere": { cast: "dnd5eactivity000", follow: "dnd5eactivity100" }
};

describe("follow-ups of an already cast spell: no second slot (dataFixes)", () => {
  for ( const [ident, { cast, follow }] of Object.entries(CASES) ) {
    it(`${ident} : la suite ne dépense plus d'emplacement, le lancement si`, () => {
      const plan = dataFixPlan(spell({ [cast]: true, [follow]: true }), CONTENT[ident].dataFixes);
      expect(plan.item).toEqual({ [`system.activities.${follow}.consumption.spellSlot`]: false });
    });
    it(`${ident} : rien à faire sur une donnée déjà corrigée, ni sans l'activité`, () => {
      expect(planIsEmpty(dataFixPlan(spell({ [cast]: true, [follow]: false }), CONTENT[ident].dataFixes))).toBe(true);
      expect(planIsEmpty(dataFixPlan(spell({ [cast]: true }), CONTENT[ident].dataFixes))).toBe(true);
    });
  }
});
