import { describe, it, expect } from "vitest";
import { initiativeReroll, rerolledInitiative } from "../module/scripts/core/initiative.mjs";
import { lifestealAmount } from "../module/scripts/core/drain.mjs";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";

describe("§120 : Hypervigilance (rerollInitiative)", () => {
  const rule = { atMost: 9 };
  it("rerolls a d20 of 9 or less, not above", () => {
    expect(initiativeReroll(rule, { number: 1, kept: 9 })).toBe("1d20");
    expect(initiativeReroll(rule, { number: 1, kept: 1 })).toBe("1d20");
    expect(initiativeReroll(rule, { number: 1, kept: 10 })).toBeNull();
    expect(initiativeReroll(null, { number: 1, kept: 3 })).toBeNull();
  });
  it("with Advantage: rerolls both dice, same guard", () => {
    expect(initiativeReroll(rule, { number: 2, kept: 7, keep: "kh" })).toBe("2d20kh");
  });
  it("keeps bonus and tie-breaker: only the d20 difference changes", () => {
    expect(rerolledInitiative(11.14, 4, 17)).toBeCloseTo(24.14);
  });
  it("validates the key", () => {
    expect(validateEntry({ rerollInitiative: { atMost: 9 } })).toEqual([]);
    expect(validateEntry({ rerollInitiative: { atMost: 20 } }).length).toBe(1);
    expect(validateEntry({ rerollInitiative: { atMost: 9, x: 1 } }).length).toBe(1);
  });
});

describe("§120 : Caresse du vampire (lifesteal)", () => {
  it("half the necrotic damage, rounded down", () => {
    const damages = [{ value: 11, type: "necrotic" }, { value: 4, type: "piercing" }];
    expect(lifestealAmount(damages, { damageType: "necrotic", fraction: 0.5 })).toBe(5);
    expect(lifestealAmount(damages, { damageType: "necrotic" })).toBe(11);
    expect(lifestealAmount([{ value: 0, type: "necrotic" }], { damageType: "necrotic", fraction: 0.5 })).toBe(0);
  });
  it("validates and merges the key", () => {
    expect(validateEntry({ lifesteal: { damageType: "necrotic", fraction: 0.5 } })).toEqual([]);
    expect(validateEntry({ lifesteal: { fraction: 2 } }).length).toBe(1);
    expect(mergeEntries([{ lifesteal: { damageType: "necrotic", fraction: 0.5 } }]).lifesteal).toEqual({ damageType: "necrotic", fraction: 0.5 });
  });
});
