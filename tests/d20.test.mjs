/**
 * Issue #47: the card says which d20s rolled — the kept die and the discarded die of an Advantage or a Disadvantage.
 */
import { describe, it, expect } from "vitest";
import { keptAndDropped } from "../module/scripts/core/d20.mjs";

describe("kept and discarded dice of a d20", () => {
  it("normal roll: nothing to say", () => {
    expect(keptAndDropped([{ result: 11, active: true }], 0)).toBeNull();
    expect(keptAndDropped([], 0)).toBeNull();
    expect(keptAndDropped(undefined, 1)).toBeNull();
  });

  it("Disadvantage: the lowest kept, the highest discarded", () => {
    const results = [{ result: 16, active: true }, { result: 19, active: false, discarded: true }];
    expect(keptAndDropped(results, -1)).toEqual({ mode: -1, kept: [16], dropped: [19] });
  });

  it("Advantage: the highest kept, the lowest discarded", () => {
    const results = [{ result: 4, active: false, discarded: true }, { result: 14, active: true }];
    expect(keptAndDropped(results, 1)).toEqual({ mode: 1, kept: [14], dropped: [4] });
  });

  it("three dice (Advantage with three d20): two discarded", () => {
    const results = [{ result: 4, active: false, discarded: true }, { result: 14, active: true }, { result: 9, active: false, discarded: true }];
    expect(keptAndDropped(results, 1)).toEqual({ mode: 1, kept: [14], dropped: [4, 9] });
  });

  it("a rerolled die is neither kept nor discarded", () => {
    const results = [{ result: 1, active: false, rerolled: true }, { result: 12, active: true }];
    expect(keptAndDropped(results, 0)).toBeNull();
    const withAdvantage = [{ result: 1, active: false, rerolled: true }, { result: 12, active: true }, { result: 7, active: false, discarded: true }];
    expect(keptAndDropped(withAdvantage, 1)).toEqual({ mode: 1, kept: [12], dropped: [7] });
  });

  it("with no known mode, the dice say which", () => {
    expect(keptAndDropped([{ result: 16, active: true }, { result: 19, active: false, discarded: true }], undefined)?.mode).toBe(-1);
    expect(keptAndDropped([{ result: 16, active: true }, { result: 3, active: false, discarded: true }], 0)?.mode).toBe(1);
  });
});

/**
 * §435: the keep of a d20 — dnd5e 6 notes `adv` / `dis` (D20Die#applyAdvantage), not `kh` / `kl`. A Disadvantage read as an
 * Advantage made the wrong d20 be kept after a Heroic Inspiration reroll, and Hypervigilance rerolled "2d20" (the sum).
 */
import { d20Keep } from "../module/scripts/core/d20.mjs";
import { rerolledD20 } from "../module/scripts/core/heroic.mjs";
import { initiativeReroll } from "../module/scripts/core/initiative.mjs";

describe("garde d'un d20 (§435)", () => {
  it("reads adv / dis from dnd5e 6, kh / kl written by hand", () => {
    expect(d20Keep(["dis"])).toBe("kl");
    expect(d20Keep(["adv"])).toBe("kh");
    expect(d20Keep(["adv2"])).toBe("kh");
    expect(d20Keep(["kl"])).toBe("kl");
    expect(d20Keep(["kh1"])).toBe("kh");
    expect(d20Keep(["min10"])).toBeNull();
    expect(d20Keep([])).toBeNull();
    expect(d20Keep(undefined)).toBeNull();
  });

  it("the mode noted by dnd5e takes precedence", () => {
    expect(d20Keep([], -1)).toBe("kl");
    expect(d20Keep(["adv"], -1)).toBe("kl");
    expect(d20Keep([], 1)).toBe("kh");
    expect(d20Keep(["dis"], 0)).toBe("kl");
  });

  it("Disadvantage 17 / 8 (+5 = 13), the 17 rerolled to 7: the lower of the two, 7, counts (12)", () => {
    const mode = d20Keep(["dis"]) === "kl" ? "disadvantage" : "advantage";
    expect(rerolledD20({ values: [17, 8], mode, total: 13 }, 0, 7)).toMatchObject({ kept: 7, total: 12 });
  });

  it("Hypervigilance with Disadvantage: 2d20kl, not 2d20", () => {
    expect(initiativeReroll({ atMost: 9 }, { number: 2, kept: 4, keep: d20Keep(["dis"]) })).toBe("2d20kl");
  });
});
