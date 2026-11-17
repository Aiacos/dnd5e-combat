import { describe, it, expect } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dataFixPlan, planIsEmpty } from "../module/scripts/core/data-fixes.mjs";

/** La donnée du sort telle que dnd5e la rend sur une fiche : chaque activité avec `consumption.spellSlot` (vrai par défaut). */
const spell = (activities) => ({ system: { activities: Object.fromEntries(Object.entries(activities)
  .map(([id, spellSlot]) => [id, { _id: id, consumption: { spellSlot, targets: [] } }])) }, effects: [] });

const CASES = {
  "detect-thoughts": { cast: "cNjNJvq5tlzmAjzM", follow: "dnd5eactivity000" },
  "conjure-fey": { cast: "w2sWkRQ3xMVRf7g3", follow: "sKmRcy0IDp9aOuAt" },
  "guardian-of-faith": { cast: "dnd5eactivity000", follow: "dnd5eactivity100" },
  "flaming-sphere": { cast: "dnd5eactivity000", follow: "dnd5eactivity100" }
};

describe("suites d'un sort déjà lancé : pas de second emplacement (dataFixes)", () => {
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
