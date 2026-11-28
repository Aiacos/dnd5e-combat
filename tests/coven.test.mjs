import { describe, it, expect } from "vitest";
import { sharedValue } from "../module/scripts/core/coven.mjs";

describe("§19.5: shared HP of a coven", () => {
  it("carries over the difference, bounded to 0 and to the maximum", () => {
    expect(sharedValue({ value: 210, max: 210 }, -20)).toBe(190);
    expect(sharedValue({ value: 15, max: 210 }, -20)).toBe(0);
    expect(sharedValue({ value: 200, max: 210 }, 30)).toBe(210);
  });
  it("nothing to write: zero difference, already at the cap, or already at 0 under damage", () => {
    expect(sharedValue({ value: 210, max: 210 }, 0)).toBeNull();
    expect(sharedValue({ value: 210, max: 210 }, 5)).toBeNull();
    expect(sharedValue({ value: 0, max: 210 }, -5)).toBeNull();
    expect(sharedValue({ value: 0, max: 210 }, 5)).toBe(5);
  });
  it("two hits from the same source count twice: the differences add up", () => {
    // A takes 20, B takes 25 (same Fireball): each receives the other's difference.
    let a = 190, b = 185, c = 210;
    b = sharedValue({ value: b, max: 210 }, -20); c = sharedValue({ value: c, max: 210 }, -20);
    a = sharedValue({ value: a, max: 210 }, -25); c = sharedValue({ value: c, max: 210 }, -25);
    expect([a, b, c]).toEqual([165, 165, 165]);
  });
});
