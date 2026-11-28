/**
 * §406: the computation of the expected dice of the `MONTEE` sweep (tools/lib/balayage.mjs), on Handbook activity data copied
 * in their shape (no item text) — same rule as `DamageData#scaledFormula` of dnd5e 6.0.6.
 */
import { describe, it, expect } from "vitest";
import { upcastDice, missingDice } from "../tools/lib/balayage.mjs";

const part = (number, denomination, scaling={}, custom=null) => ({ number, denomination, types: ["fire"],
  custom: custom ? { enabled: true, formula: custom } : { enabled: false, formula: "" }, scaling: { mode: "", number: 1, formula: "", ...scaling } });

describe("MONTEE sweep — expected dice (§406)", () => {
  it("\"whole\" mode: one more die per level (Chromatic Orb 3d8, two levels above → 5d8)", () => {
    expect(upcastDice({ damage: { parts: [part(3, 8, { mode: "whole" })] } }, 2)).toEqual([{ count: 5, faces: 8, part: 0 }]);
  });

  it("\"half\" mode: one level in two (Spiritual Weapon 1d8, +2 levels → 2d8; +1 → nothing that rises)", () => {
    expect(upcastDice({ damage: { parts: [part(1, 8, { mode: "half" })] } }, 2)).toEqual([{ count: 2, faces: 8, part: 0 }]);
    expect(upcastDice({ damage: { parts: [part(1, 8, { mode: "half" })] } }, 1)).toEqual([]);
  });

  it("without scaling, or scaling of 0 dice: nothing expected", () => {
    expect(upcastDice({ damage: { parts: [part(1, 10)] } }, 2)).toEqual([]);
    expect(upcastDice({ damage: { parts: [part(1, 10, { mode: "whole", number: 0 })] } }, 2)).toEqual([]);
    expect(upcastDice({ type: "utility" }, 2)).toEqual([]);
  });

  it("custom formula: the first die rises; `scaling.formula` is added that many times", () => {
    expect(upcastDice({ damage: { parts: [part(null, null, { mode: "whole", number: 2 }, "4d6 + @mod")] } }, 2)).toEqual([{ count: 8, faces: 6, part: 0 }]);
    expect(upcastDice({ damage: { parts: [part(2, 8, { mode: "whole", number: 0, formula: "1d6" })] } }, 3))
      .toEqual([{ count: 3, faces: 6, part: 0, formula: true }]);
  });

  it("the healing of a heal activity (Cure Wounds 2d8, +2 → 6d8 with 2 dice per level)", () => {
    expect(upcastDice({ healing: part(2, 8, { mode: "whole", number: 2 }) }, 2)).toEqual([{ count: 6, faces: 8, part: 0 }]);
  });

  it("missingDice: the exact count or its double (critical) passes; the base level is a shortfall", () => {
    const want = [{ count: 5, faces: 8 }];
    expect(missingDice(want, ["5d8"])).toEqual([]);
    expect(missingDice(want, ["10d8"])).toEqual([]);
    expect(missingDice(want, ["3d8"])).toEqual(["5d8 attendu"]);
    expect(missingDice([{ count: 4, faces: 6 }, { count: 2, faces: 6 }], ["4d6 + 2d6 + 5"])).toEqual([]);
  });
});
