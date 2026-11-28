import { describe, it, expect } from "vitest";
import { heroicWanted, keptOf, rerolledD20, damageDiceLow, rerolledDamage, liveDice } from "../module/scripts/core/heroic.mjs";

describe("§282 Heroic Inspiration", () => {
  it("follows the client setting: on each roll, on a failure (or an unknown outcome), never", () => {
    expect(heroicWanted("on", false)).toBe(true);
    expect(heroicWanted("failure", false)).toBe(false);
    expect(heroicWanted("failure", true)).toBe(true);
    expect(heroicWanted("failure", null)).toBe(true);
    expect(heroicWanted("off", true)).toBe(false);
  });

  it("keeps the right d20 according to Advantage / Disadvantage", () => {
    expect(keptOf([7], null)).toBe(7);
    expect(keptOf([3, 18], "advantage")).toBe(18);
    expect(keptOf([3, 18], "disadvantage")).toBe(3);
  });

  it("rerolls a single d20 and shifts the total by the difference", () => {
    const r = rerolledD20({ values: [4], mode: null, total: 9 }, 0, 15);
    expect(r).toMatchObject({ old: 4, kept: 15, total: 20, delta: 11, critical: false, fumble: false });
  });

  it("with Disadvantage, rerolling the low die keeps only the lower of the two", () => {
    const r = rerolledD20({ values: [3, 12], mode: "disadvantage", total: 8 }, 0, 19);
    expect(r).toMatchObject({ kept: 12, total: 17, delta: 9 });
  });

  it("the new roll must be used, even if worse; it again makes a Critical Hit and an automatic failure", () => {
    expect(rerolledD20({ values: [14], total: 19 }, 0, 1)).toMatchObject({ total: 6, delta: -13, fumble: true });
    expect(rerolledD20({ values: [1], total: 6, criticalSuccess: 19 }, 0, 19)).toMatchObject({ critical: true, fumble: false });
  });

  it("damage: \"failure\" = a die at half its maximum or less", () => {
    expect(damageDiceLow([{ faces: 6, value: 3 }])).toBe(true);
    expect(damageDiceLow([{ faces: 6, value: 4 }, { faces: 8, value: 5 }])).toBe(false);
  });

  it("damage: the type's share moves by the difference, never below zero", () => {
    expect(rerolledDamage(9, 2, 6)).toBe(13);
    expect(rerolledDamage(1, 3, 1)).toBe(0);
  });
});

describe("rerollable dice of a damage roll (§435)", () => {
  const d6 = (...values) => ({ faces: 6, results: values.map(v => ({ result: v, active: true })) });

  it("a simple dice term: each of its active results", () => {
    expect(liveDice([d6(3, 5), { operator: "+" }, { number: 3 }]).map(d => d.result.result)).toEqual([3, 5]);
  });

  it("Savage Attacker {2d6,2d6}kh: only the dice of the kept roll", () => {
    const pool = { rolls: [{ terms: [d6(3, 3)] }, { terms: [d6(4, 1)] }],
      results: [{ result: 6, active: true }, { result: 5, active: false, discarded: true }] };
    expect(liveDice([pool, { operator: "+" }, { number: 3 }]).map(d => d.result.result)).toEqual([3, 3]);
  });

  it("a rerolled or discarded result does not count", () => {
    const term = { faces: 8, results: [{ result: 1, active: false, rerolled: true }, { result: 7, active: true }, { result: 2, discarded: true }] };
    expect(liveDice([term]).map(d => d.result.result)).toEqual([7]);
  });
});
