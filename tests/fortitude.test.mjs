/** §61: Undead Fortitude — Constitution save (DC 5 + damage) when dropping to 0 HP, except radiant or Critical Hit. */
import { describe, it, expect } from "vitest";
import { fortitudeSave } from "../module/scripts/core/fortitude.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("fortitudeSave", () => {
  it("dropping to 0 HP: Constitution save, DC 5 + damage taken", () => {
    expect(fortitudeSave({ hp: 6, through: 9, taken: 9, types: ["slashing"] })).toEqual({ ability: "con", dc: 14 });
  });
  it("dropping exactly to 0 HP counts", () => {
    expect(fortitudeSave({ hp: 6, through: 6, taken: 6 })).toEqual({ ability: "con", dc: 11 });
  });
  it("absorbed Temporary Hit Points count toward the DC (damage taken), not toward the drop", () => {
    expect(fortitudeSave({ hp: 4, through: 4, taken: 10 })?.dc).toBe(15);
    expect(fortitudeSave({ hp: 4, through: 3, taken: 10 })).toBeNull();
  });
  it("staying above 0 HP, or already being there: nothing", () => {
    expect(fortitudeSave({ hp: 10, through: 9, taken: 9 })).toBeNull();
    expect(fortitudeSave({ hp: 0, through: 5, taken: 5 })).toBeNull();
  });
  it("radiant damage (even mixed with other damage) or a Critical Hit: no save", () => {
    expect(fortitudeSave({ hp: 5, through: 8, taken: 8, types: ["radiant"] })).toBeNull();
    expect(fortitudeSave({ hp: 5, through: 8, taken: 8, types: ["slashing", "radiant"] })).toBeNull();
    expect(fortitudeSave({ hp: 5, through: 8, taken: 8, types: ["slashing"], critical: true })).toBeNull();
  });
  it("the DC keeps only whole damage", () => {
    expect(fortitudeSave({ hp: 3, through: 7.5, taken: 7.5 })?.dc).toBe(12);
  });
});

describe("contenu", () => {
  it("undead-fortitude carries the rule, and the entry is valid", () => {
    expect(CONTENT["undead-fortitude"]?.fortitude).toBe(true);
    expect(validateEntry(CONTENT["undead-fortitude"])).toEqual([]);
  });
  it("fortitude n'admet que true", () => {
    expect(validateEntry({ fortitude: "oui" }).length).toBeGreaterThan(0);
  });
});
