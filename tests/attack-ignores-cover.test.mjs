import { describe, it, expect } from "vitest";
import { coverIgnoreOf, coverLeft } from "../module/scripts/core/feats.mjs";
import { validateEntry, ENTRY_KEYS } from "../module/scripts/core/content.mjs";

const half = { degree: "half", bonus: 2 };
const threeQuarters = { degree: "threeQuarters", bonus: 5 };
const total = { degree: "total" };

describe("attackIgnoresCover: the item's attack ignores half or three-quarters Cover on its target", () => {
  it("coverIgnoreOf: the strongest of what makes Cover ignored (true, then \"half\", then nothing)", () => {
    expect(coverIgnoreOf()).toBe(false);
    expect(coverIgnoreOf(false, undefined, null)).toBe(false);
    expect(coverIgnoreOf(false, "half")).toBe("half");
    expect(coverIgnoreOf("half", true)).toBe(true);
    expect(coverIgnoreOf(true, false)).toBe(true);
  });

  it("with coverLeft: true removes half and three-quarters Cover, \"half\" the half only, Total Cover remains", () => {
    expect(coverLeft(half, coverIgnoreOf(false, true))).toBe(null);
    expect(coverLeft(threeQuarters, coverIgnoreOf(false, true))).toBe(null);
    expect(coverLeft(total, coverIgnoreOf(false, true))).toBe(total);
    expect(coverLeft(half, coverIgnoreOf("half"))).toBe(null);
    expect(coverLeft(threeQuarters, coverIgnoreOf("half"))).toBe(threeQuarters);
    expect(coverLeft(half, coverIgnoreOf(false))).toBe(half);
  });

  it("the schema: true or \"half\"", () => {
    expect(ENTRY_KEYS).toContain("attackIgnoresCover");
    expect(validateEntry({ attackIgnoresCover: true })).toEqual([]);
    expect(validateEntry({ attackIgnoresCover: "half" })).toEqual([]);
    expect(validateEntry({ attackIgnoresCover: "total" })).toEqual(["attackIgnoresCover: true, \"half\" or absent"]);
    expect(validateEntry({ attackIgnoresCover: false })).toEqual(["attackIgnoresCover: true, \"half\" or absent"]);
  });
});
