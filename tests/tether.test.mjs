import { describe, it, expect } from "vitest";
import { tetherBreak } from "../module/scripts/core/tether.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("Enchanted trait: breaking the link", () => {
  it("in range and without Total Cover: holds", () => {
    expect(tetherBreak({ distance: 60, maxRange: 60, totalCover: false })).toBe(null);
  });
  it("beyond the range", () => {
    expect(tetherBreak({ distance: 65, maxRange: 60, totalCover: false })).toBe("range");
  });
  it("abri total", () => {
    expect(tetherBreak({ distance: 20, maxRange: 60, totalCover: true })).toBe("cover");
  });
  it("distance inconnue : seul l'abri juge", () => {
    expect(tetherBreak({ distance: null, maxRange: 60, totalCover: false })).toBe(null);
  });
});

describe("schema: ranges, tether", () => {
  it("valides", () => {
    expect(validateEntry({
      ranges: { dnd5eactivity000: { value: 60, units: "ft" } },
      tether: { attack: "dnd5eactivity000", activity: "ffuqn0xdclG9YAQt", range: { value: 60, units: "ft" } }
    })).toEqual([]);
  });
  it("rejected", () => {
    expect(validateEntry({ ranges: { dnd5eactivity000: { value: 0, units: "ft" } } })).toEqual(["ranges.dnd5eactivity000: { value, units }"]);
    expect(validateEntry({ tether: { attack: "court", activity: "ffuqn0xdclG9YAQt", range: { value: 60, units: "ft" } } }))
      .toEqual(["tether.attack: activity id (16 characters) expected"]);
  });
});
