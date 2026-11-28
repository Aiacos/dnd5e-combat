/**
 * Extended Spell (Metamagic, SRD 5.2): the duration of a spell of 1 minute or more doubled, 24 hours at most; Advantage on
 * Concentration saves if the spell requires one.
 */
import { describe, it, expect } from "vitest";
import { extendedSeconds } from "../module/scripts/core/extended.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("extendedSeconds — the doubled duration", () => {
  it("one minute and more: the double, in all units", () => {
    expect(extendedSeconds({ value: 60, units: "seconds" })).toBe(120);
    expect(extendedSeconds({ value: 1, units: "minute" })).toBe(120);
    expect(extendedSeconds({ value: 10, units: "minutes" })).toBe(1200);
    expect(extendedSeconds({ value: 10, units: "rounds" })).toBe(120);
    expect(extendedSeconds({ value: 8, units: "hours" })).toBe(57600);
  });
  it("24 heures au plus", () => {
    expect(extendedSeconds({ value: 16, units: "hours" })).toBe(86400);
    expect(extendedSeconds({ value: 24, units: "hours" })).toBe(null);
    expect(extendedSeconds({ value: 7, units: "days" })).toBe(null);
  });
  it("less than a minute, or no numeric duration: nothing", () => {
    expect(extendedSeconds({ value: 1, units: "round" })).toBe(null);
    expect(extendedSeconds({ value: 30, units: "seconds" })).toBe(null);
    expect(extendedSeconds({ value: null, units: "seconds" })).toBe(null);
    expect(extendedSeconds({ value: 1, units: "special" })).toBe(null);
    expect(extendedSeconds(null)).toBe(null);
  });
});

describe("the entry", () => {
  it("Extended Spell: an option held for the next spell", () => {
    expect(CONTENT["extended-spell"]).toEqual({ metamagic: { activity: "WGQHGHweOlSpZDHp", kind: "extended" } });
    expect(validateEntry(CONTENT["extended-spell"])).toEqual([]);
  });
});
