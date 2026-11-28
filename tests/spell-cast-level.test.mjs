import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { holds, unknownFacts } from "../module/scripts/core/triggers.mjs";
import { knownCastLevel, castLevelAtMost, castLevelAtLeast } from "../module/scripts/core/counter.mjs";

// §481: the `spell.castLevel…` facts (adapter/facts.mjs, re-read in the source: it touches Foundry, so it is not imported here).
const factsSource = readFileSync(new URL("../module/scripts/adapter/facts.mjs", import.meta.url), "utf8");
const ADAPTER_FACTS = Array.from(factsSource.matchAll(/^\s+"([a-z]+\.[A-Za-z]+)":/gm), m => m[1]);
const gatesSource = readFileSync(new URL("../module/scripts/runtime/gates.mjs", import.meta.url), "utf8");

/** The facts as the adapter composes them for a given level. */
const factsAt = cast => ({
  "spell.castLevel": cast,
  "spell.castLevelAtMost": n => castLevelAtMost(cast, n),
  "spell.castLevelAtLeast": n => castLevelAtLeast(cast, n),
  "target.seesSource": true
});

describe("§481 : niveau de lancement connu (knownCastLevel)", () => {
  it("the level the moment knows wins (gate castsSpell: chosen slot)", () => {
    expect(knownCastLevel({ castLevel: 5, isSpell: true, level: 3 })).toBe(5);
    expect(knownCastLevel({ castLevel: 0, isSpell: true, level: 3 })).toBe(0);   // cantrip: 0, not "unknown"
    expect(knownCastLevel({ castLevel: "4" })).toBe(4);
  });

  it("otherwise the item's: level, dnd5e scaling, the feature that casts it", () => {
    expect(knownCastLevel({ isSpell: true, level: 1 })).toBe(1);
    expect(knownCastLevel({ isSpell: true, level: 1, scaling: 2 })).toBe(3);    // scaled copy of a message
    expect(knownCastLevel({ isSpell: true, level: 3, linkedLevel: 4 })).toBe(4); // a monster's "Fireball (level 4)"
    expect(knownCastLevel({ isSpell: true, level: 0 })).toBe(0);
  });

  it("outside a spell, or without a readable level: null", () => {
    expect(knownCastLevel({ isSpell: false, level: 3 })).toBeNull();
    expect(knownCastLevel({ isSpell: true, level: null })).toBeNull();
    expect(knownCastLevel({ isSpell: true, level: undefined })).toBeNull();
    expect(knownCastLevel()).toBeNull();
  });
});

describe("§481 : bornes de niveau", () => {
  it("au plus / au moins, bornes comprises", () => {
    expect(castLevelAtMost(3, 3)).toBe(true);
    expect(castLevelAtMost(0, 3)).toBe(true);
    expect(castLevelAtMost(4, 3)).toBe(false);
    expect(castLevelAtLeast(4, 4)).toBe(true);
    expect(castLevelAtLeast(3, 4)).toBe(false);
  });

  it("an unknown level never holds, an unreadable bound neither", () => {
    expect(castLevelAtMost(null, 9)).toBe(false);
    expect(castLevelAtLeast(null, 0)).toBe(false);
    expect(castLevelAtMost(2, "trois")).toBe(false);
  });
});

describe("§481: spell.castLevel… facts in a reaction condition", () => {
  const condition = { "target.seesSource": true, "spell.castLevelAtMost": 3 };

  it("the adapter provides them, validation knows them", () => {
    for ( const key of ["spell.castLevel", "spell.castLevelAtMost", "spell.castLevelAtLeast"] ) expect(ADAPTER_FACTS).toContain(key);
    expect(unknownFacts(condition, Object.fromEntries(ADAPTER_FACTS.map(k => [k, true])))).toEqual([]);
  });

  it("\"a spell of level 3 or less\": level 3 yes, level 4 no, not a spell no", () => {
    expect(holds(condition, factsAt(0))).toBe(true);
    expect(holds(condition, factsAt(3))).toBe(true);
    expect(holds(condition, factsAt(4))).toBe(false);
    expect(holds(condition, factsAt(null))).toBe(false);
    expect(holds({ "spell.castLevel": [1, 2] }, factsAt(2))).toBe(true);
    expect(holds({ not: { "spell.castLevelAtLeast": 4 } }, factsAt(3))).toBe(true);
  });

  it("the castsSpell gate passes the level to the conditions (counterCandidates, isTargeted, counter-Counterspell)", () => {
    expect(gatesSource).toMatch(/matching\("castsSpell", \{[^}]*castLevel \}\)/);
    expect(gatesSource).toMatch(/matching\("isTargeted", \{[^}]*castLevel \}\)/);
    expect(gatesSource).toMatch(/counterCandidates\(activity, origin, castLevel\)/);
    expect(gatesSource).not.toMatch(/counterCandidates\(activity, origin\)/);
  });
});
