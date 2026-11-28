/**
 * Superior Hunter's Prey (Ranger, Hunter 11 — SRD 5.2): once per turn, damage dealt to the marked creature also deals the
 * extra damage of Hunter's Mark to another creature seen within 9 m of the first.
 */
import { describe, it, expect } from "vitest";
import { splashTargets, splashAvailable, splashFormula } from "../module/scripts/core/mark-splash.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("splashTargets", () => {
  const tokens = [{ id: "first", name: "Marquée", distance: 0, enemy: true, seen: true, first: true },
    { id: "near", name: "Proche", distance: 10, enemy: true, seen: true },
    { id: "far", name: "Loin", distance: 35, enemy: true, seen: true },
    { id: "ally", name: "Allié", distance: 5, enemy: false, seen: true },
    { id: "unseen", name: "Cachée", distance: 5, enemy: true, seen: false },
    { id: "mid", name: "Milieu", distance: 30, enemy: true, seen: true }];
  it("another creature, an enemy, seen, within 9 m of the first — the nearest first", () => {
    expect(splashTargets(tokens, 30).map(t => t.id)).toEqual(["near", "mid"]);
  });
  it("nobody in range: nothing", () => {
    expect(splashTargets(tokens, 5)).toEqual([]);
  });
});

describe("splashAvailable — once per turn", () => {
  it("not twice in the same turn; again on the next; always outside combat", () => {
    expect(splashAvailable(null, "c.1.0")).toBe(true);
    expect(splashAvailable("c.1.0", "c.1.0")).toBe(false);
    expect(splashAvailable("c.1.0", "c.2.0")).toBe(true);
    expect(splashAvailable("c.1.0", null)).toBe(true);
  });
});

describe("splashFormula", () => {
  const rule = CONTENT["superior-hunters-prey"].markSplash;
  it("the d6 of the Mark; the d10 with Foe Slayer", () => {
    expect(splashFormula(rule, ["hunters-mark"])).toBe("1d6");
    expect(splashFormula(rule, ["hunters-mark", "foe-slayer"])).toBe("1d10");
  });
});

describe("the entry and the schema", () => {
  it("Superior Hunter's Prey", () => {
    expect(validateEntry(CONTENT["superior-hunters-prey"])).toEqual([]);
    expect(CONTENT["superior-hunters-prey"].markSplash.range).toEqual({ value: 30, units: "ft" });
    expect(validateEntry({ markSplash: { mark: "hunters-mark", formula: "1d6" } }).length).toBe(1);
  });
});
