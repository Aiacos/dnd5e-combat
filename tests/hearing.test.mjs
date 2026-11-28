/** §62: hearing — you know where a creature you cannot see is, unless it is Hidden. */
import { describe, it, expect } from "vitest";
import { hears, locationUnknown, hearingRange, beyondHearing } from "../module/scripts/core/hearing.mjs";

describe("hears", () => {
  it("by default, you hear", () => {
    expect(hears({})).toBe(true);
  });
  it("Deafened, Hidden target, dead target or a wall that stops sound: you do not hear", () => {
    expect(hears({ deafened: true })).toBe(false);
    expect(hears({ hidden: true })).toBe(false);
    expect(hears({ silent: true })).toBe(false);
    expect(hears({ soundBlocked: true })).toBe(false);
  });
});

describe("hearing range (`hearingRange` setting, house rule)", () => {
  it("without the setting, or a formula that does not give a number: no range", () => {
    for ( const value of [null, undefined, NaN, Infinity, -5, "30", {}] ) expect(hearingRange(value), String(value)).toBe(null);
    expect(hearingRange(30)).toBe(30);
    expect(hearingRange(0)).toBe(0);
  });
  it("without a range, nothing is too far; with one, the limit is included", () => {
    expect(beyondHearing(1000, null)).toBe(false);
    expect(beyondHearing(1000, undefined)).toBe(false);
    expect(beyondHearing(30, 30)).toBe(false);
    expect(beyondHearing(35, 30)).toBe(true);
    expect(beyondHearing(5, 0)).toBe(true);
  });
  it("beyond the range, you do not hear", () => {
    expect(hears({ outOfRange: true })).toBe(false);
    expect(hears({ outOfRange: false })).toBe(true);
  });
});

describe("locationUnknown", () => {
  it("Hidden and not seen: unknown position", () => {
    expect(locationUnknown({ hidden: true, sees: false })).toBe(true);
  });
  it("Hidden but perceived (Blindsight…): you know where it is", () => {
    expect(locationUnknown({ hidden: true, sees: true })).toBe(false);
  });
  it("Invisible without being Hidden: you hear it, you know where it is", () => {
    expect(locationUnknown({ hidden: false, sees: false })).toBe(false);
  });
  it("sight cannot decide: we let it through", () => {
    expect(locationUnknown({ hidden: true, sees: null })).toBe(false);
  });
});
