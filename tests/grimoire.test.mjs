import { describe, it, expect } from "vitest";
import { ritualMode, recoveryBudget, recoverableLevels, recoveryUses } from "../module/scripts/core/grimoire.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

const base = { ritual: true, requiresSlot: true, inCombat: false, prepared: true, adept: false, slotLeft: true };

describe("§139 : rituels", () => {
  it("prepared with a slot: up to the player; without a slot: as a ritual", () => {
    expect(ritualMode(base)).toBe("ask");
    expect(ritualMode({ ...base, slotLeft: false })).toBe("ritual");
  });
  it("unprepared: as a ritual only with Ritual Adept", () => {
    expect(ritualMode({ ...base, prepared: false })).toBe("none");
    expect(ritualMode({ ...base, prepared: false, adept: true })).toBe("ritual");
    expect(ritualMode({ ...base, prepared: false, adept: true, slotLeft: false })).toBe("ritual");
  });
  it("never in combat, nor for a spell without the tag, nor without a slot to spend", () => {
    expect(ritualMode({ ...base, inCombat: true, adept: true, slotLeft: false })).toBe("none");
    expect(ritualMode({ ...base, ritual: false, slotLeft: false })).toBe("none");
    expect(ritualMode({ ...base, requiresSlot: false })).toBe("none");
  });
});

describe("§139 : Restauration magique", () => {
  it("half the level, rounded up", () => {
    expect(recoveryBudget(1)).toBe(1);
    expect(recoveryBudget(5)).toBe(3);
    expect(recoveryBudget(20)).toBe(10);
  });
  it("levels spent, within the budget, never beyond the 5th", () => {
    const slots = { 1: { value: 0, max: 4 }, 2: { value: 3, max: 3 }, 3: { value: 1, max: 3 }, 6: { value: 0, max: 1 } };
    expect(recoverableLevels(slots, 3)).toEqual([1, 3]);
    expect(recoverableLevels(slots, 2)).toEqual([1]);
    expect(recoverableLevels(slots, 10)).toEqual([1, 3]);
    expect(recoverableLevels(slots, 0)).toEqual([]);
  });
  it("the declarations are valid", () => {
    expect(validateEntry(SHIPPED["ritual-adept"])).toEqual([]);
    expect(validateEntry(SHIPPED["arcane-recovery"])).toEqual([]);
    expect(validateEntry({ slotRecovery: { maxLevel: 5 } }).length).toBeGreaterThan(0);
  });
});

describe("where the use of a slot restoration is counted", () => {
  it("Restauration magique : sur l'item", () => {
    expect(recoveryUses({ value: 1, max: 1 })).toEqual({ on: "item", left: true });
    expect(recoveryUses({ value: 0, max: 1 })).toEqual({ on: "item", left: false });
  });
  it("\"Recovery\": on the named activity, the item having no uses", () => {
    expect(recoveryUses({ value: 0, max: "" }, { value: 1, max: "1" })).toEqual({ on: "activity", left: true });
    expect(recoveryUses({ value: 0, max: "" }, { value: 0, max: "1" })).toEqual({ on: "activity", left: false });
  });
  it("no counter anywhere: no limit", () => {
    expect(recoveryUses({ value: 0, max: "" })).toEqual({ on: null, left: true });
    expect(recoveryUses(null, null)).toEqual({ on: null, left: true });
  });
  it("content and schema", () => {
    expect(CONTENT["natural-recovery"].slotRecovery).toEqual({ class: "druid", maxLevel: 5, activity: "u0UF6WePUutyp6e6" });
    expect(validateEntry(CONTENT["natural-recovery"])).toEqual([]);
    expect(validateEntry(CONTENT["arcane-recovery"])).toEqual([]);
    expect(validateEntry({ slotRecovery: { class: "druid", activity: "court" } }).length).toBe(1);
    expect(validateEntry({ slotRecovery: { class: "druid", autre: 1 } }).length).toBe(1);
  });
});
