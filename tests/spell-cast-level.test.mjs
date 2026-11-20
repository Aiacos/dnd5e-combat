import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { holds, unknownFacts } from "../module/scripts/core/triggers.mjs";
import { knownCastLevel, castLevelAtMost, castLevelAtLeast } from "../module/scripts/core/counter.mjs";

// §481 : les faits `spell.castLevel…` (adapter/facts.mjs, relu dans la source : il touche à Foundry, on ne l'importe pas ici).
const factsSource = readFileSync(new URL("../module/scripts/adapter/facts.mjs", import.meta.url), "utf8");
const ADAPTER_FACTS = Array.from(factsSource.matchAll(/^\s+"([a-z]+\.[A-Za-z]+)":/gm), m => m[1]);
const gatesSource = readFileSync(new URL("../module/scripts/runtime/gates.mjs", import.meta.url), "utf8");

/** Les faits tels que l'adaptateur les compose pour un niveau donné. */
const factsAt = cast => ({
  "spell.castLevel": cast,
  "spell.castLevelAtMost": n => castLevelAtMost(cast, n),
  "spell.castLevelAtLeast": n => castLevelAtLeast(cast, n),
  "target.seesSource": true
});

describe("§481 : niveau de lancement connu (knownCastLevel)", () => {
  it("le niveau que le moment connaît l'emporte (porte castsSpell : emplacement choisi)", () => {
    expect(knownCastLevel({ castLevel: 5, isSpell: true, level: 3 })).toBe(5);
    expect(knownCastLevel({ castLevel: 0, isSpell: true, level: 3 })).toBe(0);   // tour de magie : 0, pas « inconnu »
    expect(knownCastLevel({ castLevel: "4" })).toBe(4);
  });

  it("sinon celui de l'item : niveau, mise à l'échelle de dnd5e, capacité qui le lance", () => {
    expect(knownCastLevel({ isSpell: true, level: 1 })).toBe(1);
    expect(knownCastLevel({ isSpell: true, level: 1, scaling: 2 })).toBe(3);    // copie mise à l'échelle d'un message
    expect(knownCastLevel({ isSpell: true, level: 3, linkedLevel: 4 })).toBe(4); // « Boule de feu (niveau 4) » d'un monstre
    expect(knownCastLevel({ isSpell: true, level: 0 })).toBe(0);
  });

  it("hors d'un sort, ou sans niveau lisible : null", () => {
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

  it("un niveau inconnu ne tient jamais, une borne illisible non plus", () => {
    expect(castLevelAtMost(null, 9)).toBe(false);
    expect(castLevelAtLeast(null, 0)).toBe(false);
    expect(castLevelAtMost(2, "trois")).toBe(false);
  });
});

describe("§481 : faits spell.castLevel… dans une condition de réaction", () => {
  const condition = { "target.seesSource": true, "spell.castLevelAtMost": 3 };

  it("l'adaptateur les fournit, la validation les connaît", () => {
    for ( const key of ["spell.castLevel", "spell.castLevelAtMost", "spell.castLevelAtLeast"] ) expect(ADAPTER_FACTS).toContain(key);
    expect(unknownFacts(condition, Object.fromEntries(ADAPTER_FACTS.map(k => [k, true])))).toEqual([]);
  });

  it("« un sort de niveau 3 ou moins » : niveau 3 oui, niveau 4 non, hors sort non", () => {
    expect(holds(condition, factsAt(0))).toBe(true);
    expect(holds(condition, factsAt(3))).toBe(true);
    expect(holds(condition, factsAt(4))).toBe(false);
    expect(holds(condition, factsAt(null))).toBe(false);
    expect(holds({ "spell.castLevel": [1, 2] }, factsAt(2))).toBe(true);
    expect(holds({ not: { "spell.castLevelAtLeast": 4 } }, factsAt(3))).toBe(true);
  });

  it("la porte castsSpell passe le niveau aux conditions (counterCandidates, isTargeted, contre-Contresort)", () => {
    expect(gatesSource).toMatch(/matching\("castsSpell", \{[^}]*castLevel \}\)/);
    expect(gatesSource).toMatch(/matching\("isTargeted", \{[^}]*castLevel \}\)/);
    expect(gatesSource).toMatch(/counterCandidates\(activity, origin, castLevel\)/);
    expect(gatesSource).not.toMatch(/counterCandidates\(activity, origin\)/);
  });
});
