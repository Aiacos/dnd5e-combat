import { describe, expect, it } from "vitest";
import { isBreathWeapon, breathAdvantageHolds } from "../module/scripts/core/breath.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("breathAdvantage: Advantage against Dragon breath (Dragon Scale Mail)", () => {
  it("a breath is recognized by its identifier", () => {
    for ( const id of ["fire-breath", "cold-breath", "sleep-breath", "repulsion-breath"] ) expect(isBreathWeapon(id)).toBe(true);
    for ( const id of ["hold-breath", "water-breathing", "breath", "bite", null, undefined] ) expect(isBreathWeapon(id)).toBe(false);
  });
  it("against a creature of the declared type only", () => {
    const rule = ITEM_FIXES["dragon-scale-mail-enchanted"].breathAdvantage;
    expect(rule).toEqual({ types: ["dragon"] });
    expect(breathAdvantageHolds(rule, "dragon")).toBe(true);
    expect(breathAdvantageHolds(rule, "monstrosity")).toBe(false);
    expect(breathAdvantageHolds(rule, null)).toBe(false);
    expect(breathAdvantageHolds(null, "dragon")).toBe(false);
  });
  it("the key is validated", () => {
    expect(validateEntry({ breathAdvantage: { types: ["dragon"] } })).toEqual([]);
    expect(validateEntry({ breathAdvantage: { types: ["wyrm"] } })).not.toEqual([]);
    expect(validateEntry({ breathAdvantage: { types: ["dragon"], extra: 1 } })).not.toEqual([]);
  });
});
