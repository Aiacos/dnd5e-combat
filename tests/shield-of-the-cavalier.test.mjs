import { describe, expect, it } from "vitest";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Bouclier du cavalier (SRD 5.2) : Coup violent", () => {
  const entry = ITEM_FIXES["shield-of-the-cavalier"];
  it("a hit pushes the target 3 m", () => {
    const [rule] = entry.triggers;
    expect(rule.on).toBe("hit");
    expect(rule.do).toEqual([{ type: "move", mode: "push", distance: 10, units: "ft" }]);
    expect(holds(rule.if, { "activity.id": "ABPaLpY5mrKpB4ou" })).toBe(true);
    expect(holds(rule.if, { "activity.id": "Zk2NWOrZcSWTaogR" })).toBe(false);
  });
  it("Prone only for a target the author's size or smaller", () => {
    expect(entry.effectsIf).toEqual({ "target.sizeAtMost": "source" });
    const ranks = { tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 };
    const facts = (target, source) => ({ "target.sizeAtMost": size => ranks[target] <= ranks[(size === "source") ? source : size] });
    expect(holds(entry.effectsIf, facts("med", "med"))).toBe(true);
    expect(holds(entry.effectsIf, facts("sm", "med"))).toBe(true);
    expect(holds(entry.effectsIf, facts("lg", "med"))).toBe(false);
  });
  it("the entry is valid", () => {
    expect(validateEntry(entry, { facts: { "activity.id": true, "target.sizeAtMost": true } })).toEqual([]);
  });
});
