import { describe, expect, it } from "vitest";
import { dexSaveTakesCover, coverSaveBonus } from "../module/scripts/core/save-cover.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("l'abri et les jets de sauvegarde de Dextérité (issue #183)", () => {
  it("une sauvegarde de Dextérité qui vise sa cible reçoit le bonus ; une autre caractéristique, non", () => {
    expect(dexSaveTakesCover({ ability: "dex" })).toBe(true);
    expect(dexSaveTakesCover({ ability: "wis" })).toBe(false);
    expect(dexSaveTakesCover({ ability: "con" })).toBe(false);
  });
  it("une zone est laissée au MJ ; un sort qui ignore l'abri ne le reçoit pas", () => {
    expect(dexSaveTakesCover({ ability: "dex", area: true })).toBe(false);
    expect(dexSaveTakesCover({ ability: "dex", ignores: true })).toBe(false);
  });
  it("+2 pour un abri partiel, +5 aux trois quarts, rien sans abri ni pour un abri total", () => {
    expect(coverSaveBonus({ degree: "half", bonus: 2 })).toBe(2);
    expect(coverSaveBonus({ degree: "threeQuarters", bonus: 5 })).toBe(5);
    expect(coverSaveBonus({ degree: "total", bonus: null })).toBe(0);
    expect(coverSaveBonus({ degree: "none", bonus: 0 })).toBe(0);
    expect(coverSaveBonus(null)).toBe(0);
  });
  it("Flamme sacrée ignore l'abri", () => {
    expect(CONTENT["sacred-flame"].saveIgnoresCover).toBe(true);
    expect(validateEntry({ saveIgnoresCover: true })).toEqual([]);
    expect(validateEntry({ saveIgnoresCover: "half" })).not.toEqual([]);
  });
});
