import { describe, expect, it } from "vitest";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";

// Guide du maître 2.0.0 : la donnée contredit la table des armes à feu du Guide. Formes synthétiques (ids du pack `equipment`).
describe("objets du Guide : dé de dégâts de la table des armes à feu (dataFixes)", () => {
  const revolver = denomination => ({ effects: [], system: { damage: { base: { number: 2, denomination, types: ["piercing"], bonus: "" } } } });

  it("Revolver : 2d6 devient 2d8", () => {
    expect(dataFixPlan(revolver(6), ITEM_FIXES["revolver"].dataFixes).item).toEqual({ "system.damage.base.denomination": 8 });
  });

  it("Revolver déjà à 2d8 (celui de Tasha) ou modifié à la main : rien ne bouge", () => {
    expect(dataFixPlan(revolver(8), ITEM_FIXES["revolver"].dataFixes).fields).toEqual([]);
    expect(dataFixPlan(revolver(10), ITEM_FIXES["revolver"].dataFixes).fields).toEqual([]);
  });
});
