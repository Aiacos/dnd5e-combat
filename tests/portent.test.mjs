import { describe, it, expect } from "vitest";
import { readPortent, canForetell, portentChoices, spendPortent, foretoldRange } from "../module/scripts/core/portent.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§36: Portent", () => {
  it("reads the state as is, no value outside a d20", () => {
    expect(readPortent(undefined)).toEqual({ rolls: [], turn: null });
    expect(readPortent({ rolls: [7, 0, 21, 3.5, "12", 20, 1], turn: 4 })).toEqual({ rolls: [7, 20, 1], turn: null });
  });

  it("once per turn in combat, no limit outside combat, nothing without a noted roll", () => {
    expect(canForetell({ rolls: [7] }, null)).toBe(true);
    expect(canForetell({ rolls: [7], turn: "c.1.2" }, "c.1.2")).toBe(false);
    expect(canForetell({ rolls: [7], turn: "c.1.2" }, "c.1.3")).toBe(true);
    expect(canForetell({ rolls: [7], turn: "c.1.2" }, null)).toBe(true);
    expect(canForetell({ rolls: [] }, null)).toBe(false);
  });

  it("offers each value once, from highest to lowest", () => {
    expect(portentChoices({ rolls: [4, 17, 4] })).toEqual([17, 4]);
  });

  it("spends a single occurrence and remembers the turn", () => {
    expect(spendPortent({ rolls: [4, 17, 4] }, 4, "c.2.0")).toEqual({ rolls: [17, 4], turn: "c.2.0" });
    expect(spendPortent({ rolls: [4] }, 9, null)).toBeNull();
  });

  it("clamps the d20 to the noted value", () => {
    expect(foretoldRange(20)).toEqual({ minimum: 20, maximum: 20 });
  });

  it("content: `portent: { dice }`, positive integer — Portent 2, Greater Portent 3", () => {
    expect(validateEntry({ portent: { dice: 2 } }, { facts: {} })).toEqual([]);
    expect(validateEntry({ portent: { dice: 0 } }, { facts: {} })).toEqual(["portent: { dice } (positive integer)"]);
    expect(validateEntry({ portent: { dice: 2, keep: true } }, { facts: {} })).toEqual(["portent: { dice } (positive integer)"]);
    expect(CONTENT["portent"].portent.dice).toBe(2);
    expect(CONTENT["greater-portent"].portent.dice).toBe(3);
  });
});
