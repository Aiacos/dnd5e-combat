import { describe, expect, it } from "vitest";
import { castFixes, dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("spellFixes: what the item corrects in the spell it casts (Wand of Fear)", () => {
  const fixes = ITEM_FIXES["wand-of-fear"].spellFixes["9c7SNgBZU2KJjgFg"];
  it("Fear cast by the wand: 18 m Cone instead of 9", () => {
    const copy = { effects: [], system: { target: { template: { type: "cone", size: "30", units: "ft" } } } };
    expect(dataFixPlan(copy, castFixes(null, fixes)).item).toEqual({ "system.target.template.size": "60" });
  });
  it("a Cone already changed (by hand, or by dnd5e) does not move", () => {
    const copy = { effects: [], system: { target: { template: { type: "cone", size: "45", units: "ft" } } } };
    expect(dataFixPlan(copy, castFixes(null, fixes)).fields).toEqual([]);
  });
  it("the spell's corrections first, the item's after; neither: null", () => {
    const own = [{ path: "system.range.units", from: "self", value: "touch" }];
    expect(castFixes(own, fixes)).toEqual([...own, ...fixes]);
    expect(castFixes(own, null)).toEqual(own);
    expect(castFixes(null, null)).toBeNull();
  });
  it("the key is validated", () => {
    expect(validateEntry({ spellFixes: ITEM_FIXES["wand-of-fear"].spellFixes })).toEqual([]);
    expect(validateEntry({ spellFixes: { short: fixes } })).not.toEqual([]);
    expect(validateEntry({ spellFixes: { "9c7SNgBZU2KJjgFg": [] } })).not.toEqual([]);
  });
});
