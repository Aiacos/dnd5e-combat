import { describe, it, expect, afterEach } from "vitest";
import { lengthIn } from "../module/scripts/adapter/units.mjs";

/** `lengthIn`: the core's conversion with the dnd5e factors, and the value as is when a unit is missing. */
afterEach(() => { delete globalThis.CONFIG; });

describe("lengthIn", () => {
  it("converts with the factors of CONFIG.DND5E.movementUnits", () => {
    globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 }, m: { conversion: 10 / 3 } } } };
    expect(lengthIn(30, "ft", "m")).toBeCloseTo(9);
    expect(lengthIn(30, "ft", "ft")).toBe(30);
  });
  it("keeps the value when a unit is unknown or missing", () => {
    globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 } } } };
    expect(lengthIn(30, "ft", "lieues")).toBe(30);
    expect(lengthIn(30, undefined, "ft")).toBe(30);
  });
  it("takes the given factors (a loop reads them once)", () => {
    expect(lengthIn(10, "ft", "m", { ft: 1, m: 10 / 3 })).toBeCloseTo(3);
  });
});
