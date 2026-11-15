import { describe, expect, it } from "vitest";
import { dataFixPlan, withDataFixes } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";

// §457 : copier-coller du Guide du maître 2.0.0 (ids publics du SRD 5.2), sur des formes synthétiques.
const book = (activity, wrong) => ({ effects: [{ _id: "ownBookEffect000" }], system: { activities: {
  [activity]: { _id: activity, type: "utility", effects: [{ _id: wrong, level: {} }] } } } });

describe("objets du Guide : liens d'effet recopiés d'un autre objet, part de dégâts vide (dataFixes)", () => {
  for ( const [ident, activity, wrong] of [["manual-of-gainful-exercise", "QoMjlu00wQebXPDg", "9npFjYvEL3twc99F"],
    ["manual-of-bodily-health", "L5OnUjZIn27NHd2E", "9npFjYvEL3twc99F"], ["tome-of-clear-thought", "OCFufJcLGbTJqDqS", "jXvtCEBoDCydH8fa"]] ) {
    it(`${ident} : « Read » ne pose plus l'effet d'un autre livre, et le MJ est prévenu`, () => {
      const plan = dataFixPlan(book(activity, wrong), ITEM_FIXES[ident].dataFixes);
      expect(plan.item[`system.activities.${activity}.effects`]).toEqual([]);
      expect(ITEM_FIXES[ident].gmAlert?.key).toBe("ManuelVivacite");
    });
  }

  it("Fers du zéphyr : leur effet recréé, et l'activité y pointe au lieu de l'effet des Fers de rapidité", () => {
    const item = { effects: [], system: { activities: { Bm8dAa2MyA5NhcPU: { _id: "Bm8dAa2MyA5NhcPU", effects: [{ _id: "9lS2LxCve4hPYGMn" }] } } } };
    const { data } = withDataFixes(item, ITEM_FIXES["horseshoes-of-a-zephyr"].dataFixes);
    expect(data.effects.map(e => e._id)).toEqual(["AYtAkgcEHRws0Qeo"]);
    expect(data.effects[0].system.changes[0]).toMatchObject({ key: "system.attributes.movement.ignoredDifficultTerrain", value: "all" });
    expect(data.system.activities.Bm8dAa2MyA5NhcPU.effects).toEqual([{ _id: "AYtAkgcEHRws0Qeo" }]);
    // Déjà juste (SRD) : rien ne bouge.
    const sane = { effects: [{ _id: "AYtAkgcEHRws0Qeo" }], system: { activities: { Bm8dAa2MyA5NhcPU: { effects: [{ _id: "AYtAkgcEHRws0Qeo" }] } } } };
    expect(dataFixPlan(sane, ITEM_FIXES["horseshoes-of-a-zephyr"].dataFixes).fields).toEqual([]);
  });

  it("Bâton de tonnerre et de foudre : la part de dégâts vide de « Tonnerre et foudre » est retirée", () => {
    const lightning = { custom: { enabled: false, formula: "" }, number: 2, denomination: 6, bonus: "", types: ["lightning"], scaling: { number: 1 } };
    const empty = { custom: { enabled: false, formula: "" }, number: null, denomination: 0, bonus: "", types: [], scaling: { number: 1 } };
    const item = { effects: [], system: { activities: { EtOETCHaEK0mcw03: { damage: { parts: [lightning, empty] } } } } };
    const plan = dataFixPlan(item, ITEM_FIXES["staff-of-thunder-and-lightning"].dataFixes);
    const parts = plan.item["system.activities.EtOETCHaEK0mcw03.damage.parts"];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ number: 2, denomination: 6, types: ["lightning"] });
  });
});
