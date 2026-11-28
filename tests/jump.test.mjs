import { describe, it, expect } from "vitest";
import { jumpLimits, jumpCost, hasRunningStart } from "../module/scripts/core/jump.mjs";

describe("saut (§208)", () => {
  it("length: the Strength value with a running start, half without; height: 3 + Strength mod., half without", () => {
    expect(jumpLimits({ str: 16, runningStart: true })).toMatchObject({ long: 16, high: 6 });
    expect(jumpLimits({ str: 16, runningStart: false })).toMatchObject({ long: 8, high: 3 });
    expect(jumpLimits({ str: 15, runningStart: false })).toMatchObject({ long: 7, high: 2 });   // rounded down
    expect(jumpLimits({ str: 6, runningStart: true }).high).toBe(1);   // 3 − 2
    expect(jumpLimits({ str: 1, runningStart: true }).high).toBe(0);   // never negative
  });
  it("Second-Story Work: the better of Strength and Dexterity; Step of the Wind: distance doubled", () => {
    expect(jumpLimits({ str: 10, dex: 18, useDex: true, runningStart: true }).long).toBe(18);
    expect(jumpLimits({ str: 10, dex: 18, runningStart: true }).long).toBe(10);
    expect(jumpLimits({ str: 16, runningStart: true, double: true })).toMatchObject({ long: 32, high: 12 });
  });
  it("cost: one foot per foot; the fixed jump (9 m for 3 m) when it allows the jump or makes it cheaper", () => {
    expect(jumpCost(10, 16)).toEqual({ ok: true, cost: 10, fixed: false, limit: 16 });
    expect(jumpCost(20, 16)).toMatchObject({ ok: false, cost: 20 });
    const fixed = { distance: 30, cost: 10 };
    expect(jumpCost(25, 16, fixed)).toEqual({ ok: true, cost: 10, fixed: true, limit: 30 });
    expect(jumpCost(5, 16, fixed)).toMatchObject({ ok: true, cost: 5, fixed: false });   // shorter than the fixed cost
    expect(jumpCost(35, 16, fixed)).toMatchObject({ ok: false });
  });
  it("running start: the walk just before, from the end, as long as the token was walking", () => {
    expect(hasRunningStart([{ distance: 5, action: "walk" }, { distance: 5, action: "walk" }])).toBe(true);
    expect(hasRunningStart([{ distance: 10, action: "walk" }, { distance: 5, action: "fly" }])).toBe(false);
    expect(hasRunningStart([{ distance: 5, action: "walk" }], 5)).toBe(true);   // Athlete
    expect(hasRunningStart([])).toBe(false);
  });
});
