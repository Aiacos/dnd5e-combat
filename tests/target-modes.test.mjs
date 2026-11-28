import { describe, it, expect } from "vitest";
import { normalizeTargetModes, saveModeFor, attackModeAgainst } from "../module/scripts/core/target-modes.mjs";

describe("§249: Advantage / Disadvantage given per target", () => {
  it("unknown modes are removed; nothing: null", () => {
    expect(normalizeTargetModes([{ token: "a", mode: "advantage" }, { token: "b", mode: "normal" }, { token: "c", mode: "disadvantage" },
      { token: "", mode: "advantage" }, null])).toEqual({ a: "advantage", c: "disadvantage" });
    expect(normalizeTargetModes([{ token: "b", mode: "x" }])).toBeNull();
    expect(normalizeTargetModes(null)).toBeNull();
    // An object indexed by UUID: the core expands its dots, it is not read.
    expect(normalizeTargetModes({ a: "advantage" })).toBeNull();
  });
  it("la sauvegarde de la cible prend son mode", () => {
    const modes = { a: "advantage", b: "disadvantage" };
    expect(saveModeFor(modes, "a")).toEqual({ advantage: true, disadvantage: false });
    expect(saveModeFor(modes, "b")).toEqual({ advantage: false, disadvantage: true });
    expect(saveModeFor(modes, "z")).toEqual({ advantage: false, disadvantage: false });
    expect(saveModeFor(null, "a")).toEqual({ advantage: false, disadvantage: false });
  });
  it("the attack against it: the inverted mode", () => {
    expect(attackModeAgainst(["advantage"])).toEqual({ advantage: false, disadvantage: true, agreed: true });
    expect(attackModeAgainst(["disadvantage", "disadvantage"])).toEqual({ advantage: true, disadvantage: false, agreed: true });
    expect(attackModeAgainst([null])).toEqual({ advantage: false, disadvantage: false, agreed: true });
  });
  it("targets that disagree: nothing is placed", () => {
    expect(attackModeAgainst(["advantage", null])).toEqual({ advantage: false, disadvantage: false, agreed: false });
  });
});
