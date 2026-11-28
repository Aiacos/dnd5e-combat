import { describe, it, expect } from "vitest";
import { convertLength, isWithinRange } from "../module/scripts/core/units.mjs";

// Values of CONFIG.DND5E.movementUnits (dnd5e 6.0.1, config.mjs:2588): length in feet,
// simplified conversion 5 ft = 1.5 m.
const factors = { ft: 1, mi: 5280, m: 10 / 3, km: 10000 / 3 };

describe("convertLength", () => {
  it("leaves a value unchanged in the same unit", () => {
    expect(convertLength(9, "m", "m", factors)).toBe(9);
  });
  it("converts feet to meters", () => {
    expect(convertLength(30, "ft", "m", factors)).toBeCloseTo(9, 9);
  });
  it("rejects an unknown unit", () => {
    expect(() => convertLength(1, "toise", "m", factors)).toThrow(/toise/);
  });
});

describe("isWithinRange", () => {
  it("accepts 9 m measured for a range of 30 ft", () => {
    expect(isWithinRange({ value: 9, units: "m" }, { value: 30, units: "ft" }, factors)).toBe(true);
  });
  it("accepts 9 m measured for a range converted to 9 m", () => {
    expect(isWithinRange({ value: 9, units: "m" }, { value: 9, units: "m" }, factors)).toBe(true);
  });
  it("refuse une case de trop", () => {
    expect(isWithinRange({ value: 10.5, units: "m" }, { value: 30, units: "ft" }, factors)).toBe(false);
  });
});
