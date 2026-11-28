import { describe, it, expect } from "vitest";
import { versatileGrip } from "../module/scripts/core/attack.mjs";

const modes = ["oneHanded", "twoHanded", "thrown"];
describe("§149 : arme Polyvalente, la prise", () => {
  it("the other hand free: two-handed (without a mode, or one-handed by default / memory)", () => {
    expect(versatileGrip({ mode: null, modes, explicit: false, otherHandBusy: false })).toBe("twoHanded");
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: false, otherHandBusy: false })).toBe("twoHanded");
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: false, otherHandBusy: false })).toBe(null);
  });
  it("the other hand taken: one-handed, even if memory said two-handed", () => {
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: false, otherHandBusy: true })).toBe("oneHanded");
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: false, otherHandBusy: true })).toBe(null);
  });
  it("a player's choice, a throw, a weapon without a two-handed grip: nothing changes", () => {
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: true, otherHandBusy: false })).toBe(null);
    expect(versatileGrip({ mode: "thrown", modes, explicit: false, otherHandBusy: false })).toBe(null);
    expect(versatileGrip({ mode: null, modes: ["oneHanded"], explicit: false, otherHandBusy: false })).toBe(null);
  });

  it("§151: two-handed damage with empty hands — stays one-handed, even if dnd5e remembered two-handed", () => {
    expect(versatileGrip({ mode: null, modes, explicit: false, otherHandBusy: false, twoHandedDamage: false })).toBe("oneHanded");
    expect(versatileGrip({ mode: "twoHanded", modes, explicit: false, otherHandBusy: false, twoHandedDamage: false })).toBe("oneHanded");
    expect(versatileGrip({ mode: "oneHanded", modes, explicit: false, otherHandBusy: false, twoHandedDamage: false })).toBe(null);
  });
});
