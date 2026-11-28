import { describe, it, expect } from "vitest";
import { readyPlanOf, readyTriggered, readyReach, READY_TRIGGERS } from "../module/scripts/core/ready.mjs";

const plan = (over={}) => ({ activity: "Actor.a.Item.b.Activity.c", name: "Épée longue", trigger: "enters", target: null, reach: { value: 5, units: "ft" }, ...over });
const ok = { enemies: true, reactionAvailable: true, incapacitated: false, sees: true };

describe("§211 Ready", () => {
  it("reads the budget plan, not a simple \"ready\"", () => {
    expect(readyPlanOf({ readied: true })).toBeNull();
    expect(readyPlanOf({ readied: false })).toBeNull();
    expect(readyPlanOf({ readied: plan() })?.name).toBe("Épée longue");
    expect(readyPlanOf({ readied: plan({ trigger: "dort" }) })).toBeNull();
    expect(READY_TRIGGERS).toEqual(["enters", "attacks", "casts"]);
  });

  it("triggers on the right event, against an enemy, with the Reaction", () => {
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, ok)).toBe(true);
    expect(readyTriggered(plan(), { kind: "attacks", source: "T1" }, ok)).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, enemies: false })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, reactionAvailable: false })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, incapacitated: true })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, sees: false })).toBe(false);
    expect(readyTriggered(plan(), { kind: "enters", source: "T1" }, { ...ok, sees: null })).toBe(true);
  });

  it("a designated creature: only it triggers", () => {
    expect(readyTriggered(plan({ target: "T1" }), { kind: "enters", source: "T1" }, ok)).toBe(true);
    expect(readyTriggered(plan({ target: "T1" }), { kind: "enters", source: "T2" }, ok)).toBe(false);
  });

  it("range: reach, normal range, touch, personal, unlimited", () => {
    expect(readyReach({ melee: true, reach: 10, range: { units: "ft" } })).toEqual({ value: 10, units: "ft" });
    expect(readyReach({ melee: false, range: { value: 80, units: "ft" } })).toEqual({ value: 80, units: "ft" });
    expect(readyReach({ melee: false, range: { units: "touch" } })).toEqual({ value: 5, units: "ft" });
    expect(readyReach({ melee: false, range: { units: "self" }, template: { size: 15, units: "ft" } })).toEqual({ value: 15, units: "ft" });
    expect(readyReach({ melee: false, range: { value: null, units: "any" } })).toBeNull();
  });
});
