import { describe, it, expect } from "vitest";
import { attackModifiers, grappleHolds } from "../module/scripts/core/conditions.mjs";

const base = { attacker: ["grappled"], target: [], adjacent: true, ranged: false };

describe("Grappled (2024 rules)", () => {
  it("Disadvantage against any target other than the grappler", () => {
    expect(attackModifiers({ ...base, grappledElsewhere: true }).disadvantage).toEqual([{ who: "attacker", key: "grappled" }]);
  });
  it("no Disadvantage against the grappler, nor if the grappler is unknown", () => {
    expect(attackModifiers({ ...base, grappledElsewhere: false }).disadvantage).toEqual([]);
    expect(attackModifiers({ ...base, grappledElsewhere: null }).disadvantage).toEqual([]);
  });
  it("the grapple ends if the grappler is Incapacitated or too far", () => {
    expect(grappleHolds({ grapplerStatuses: [], withinReach: true })).toBe(true);
    expect(grappleHolds({ grapplerStatuses: [], withinReach: false })).toBe(false);
    expect(grappleHolds({ grapplerStatuses: ["unconscious"], withinReach: true })).toBe(false);
    expect(grappleHolds({ grapplerStatuses: ["incapacitated"], withinReach: true })).toBe(false);
    expect(grappleHolds({ grapplerStatuses: ["prone"], withinReach: true })).toBe(true);
  });
});

describe("Help (2024 rules), attack part", () => {
  it("an ally distracted the target: Advantage", () => {
    const r = attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false, helped: true });
    expect(r.advantage).toEqual([{ who: "situation", key: "helped" }]);
  });
  it("sans Soutien : rien", () => {
    expect(attackModifiers({ attacker: [], target: [], adjacent: true, ranged: false }).advantage).toEqual([]);
  });
});
