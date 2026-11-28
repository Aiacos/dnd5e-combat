import { describe, expect, it } from "vitest";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";

// Dungeon Master's Guide 2.0.0: the data contradicts the Guide's firearms table. Synthetic shapes (ids of the `equipment` pack).
describe("Guide items: damage die from the firearms table (dataFixes)", () => {
  const revolver = denomination => ({ effects: [], system: { damage: { base: { number: 2, denomination, types: ["piercing"], bonus: "" } } } });

  it("Revolver : 2d6 devient 2d8", () => {
    expect(dataFixPlan(revolver(6), ITEM_FIXES["revolver"].dataFixes).item).toEqual({ "system.damage.base.denomination": 8 });
  });

  it("Revolver already at 2d8 (the Tasha's one) or hand-edited: nothing changes", () => {
    expect(dataFixPlan(revolver(8), ITEM_FIXES["revolver"].dataFixes).fields).toEqual([]);
    expect(dataFixPlan(revolver(10), ITEM_FIXES["revolver"].dataFixes).fields).toEqual([]);
  });
});
