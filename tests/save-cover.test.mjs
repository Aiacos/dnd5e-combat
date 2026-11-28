import { describe, expect, it } from "vitest";
import { dexSaveTakesCover, coverSaveBonus } from "../module/scripts/core/save-cover.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Cover and Dexterity saving throws (issue #183)", () => {
  it("a Dexterity save that targets its target gets the bonus; another ability, no", () => {
    expect(dexSaveTakesCover({ ability: "dex" })).toBe(true);
    expect(dexSaveTakesCover({ ability: "wis" })).toBe(false);
    expect(dexSaveTakesCover({ ability: "con" })).toBe(false);
  });
  it("an area is left to the GM; a spell that ignores Cover does not receive it", () => {
    expect(dexSaveTakesCover({ ability: "dex", area: true })).toBe(false);
    expect(dexSaveTakesCover({ ability: "dex", ignores: true })).toBe(false);
  });
  it("+2 for Half Cover, +5 for Three-Quarters Cover, nothing without Cover or for Total Cover", () => {
    expect(coverSaveBonus({ degree: "half", bonus: 2 })).toBe(2);
    expect(coverSaveBonus({ degree: "threeQuarters", bonus: 5 })).toBe(5);
    expect(coverSaveBonus({ degree: "total", bonus: null })).toBe(0);
    expect(coverSaveBonus({ degree: "none", bonus: 0 })).toBe(0);
    expect(coverSaveBonus(null)).toBe(0);
  });
  it("Sacred Flame ignores Cover", () => {
    expect(CONTENT["sacred-flame"].saveIgnoresCover).toBe(true);
    expect(validateEntry({ saveIgnoresCover: true })).toEqual([]);
    expect(validateEntry({ saveIgnoresCover: "half" })).not.toEqual([]);
  });
});
