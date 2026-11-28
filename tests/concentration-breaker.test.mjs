import { describe, it, expect } from "vitest";
import { breaksConcentration } from "../module/scripts/core/concentration-breaker.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("§133: Concentration breaker — to the bearer (true) or to the item that wounded (\"item\")", () => {
  it("true: as soon as the bearer wounds, whatever the item", () => {
    expect(breaksConcentration({ owned: [true], item: undefined })).toBe(true);
    expect(breaksConcentration({ owned: [true], item: undefined, itemReady: false })).toBe(true);
  });

  it("\"item\": only if the damage comes from an activity of this item, ready to use", () => {
    // The actor owns the weapon, but strikes with something else: nothing.
    expect(breaksConcentration({ owned: ["item"], item: undefined })).toBe(false);
    expect(breaksConcentration({ owned: ["item"], item: true })).toBe(false);
    // It strikes with it.
    expect(breaksConcentration({ owned: ["item"], item: "item", itemReady: true })).toBe(true);
    // It is not equipped, or requires an attunement it does not have.
    expect(breaksConcentration({ owned: ["item"], item: "item", itemReady: false })).toBe(false);
  });

  it("without a declaration: nothing", () => {
    expect(breaksConcentration({ owned: [], item: undefined })).toBe(false);
    expect(breaksConcentration({})).toBe(false);
  });

  it("the schema accepts true and \"item\", nothing else", () => {
    expect(validateEntry({ concentrationBreaker: true })).toEqual([]);
    expect(validateEntry({ concentrationBreaker: "item" })).toEqual([]);
    expect(validateEntry({ concentrationBreaker: "weapon" })).toEqual(["concentrationBreaker: true, \"item\" or absent"]);
    expect(validateEntry({ concentrationBreaker: false })).toEqual(["concentrationBreaker: true, \"item\" or absent"]);
  });
});
