import { describe, it, expect } from "vitest";
import { d20Law, bonusLaw, hitChance, asPercent, hitChanceShows, HIT_CHANCE_LEVELS } from "../module/scripts/core/hitchance.mjs";

const sum = law => law.reduce((a, b) => a + b, 0);

describe("loi du d20", () => {
  it("each mode sums to 1", () => {
    for ( const mode of [1, 0, -1] ) expect(sum(d20Law(mode))).toBeCloseTo(1, 12);
  });
  it("Advantage: 20 more likely than 1; Disadvantage: the reverse", () => {
    expect(d20Law(1)[20]).toBeCloseTo(39 / 400, 12);
    expect(d20Law(1)[1]).toBeCloseTo(1 / 400, 12);
    expect(d20Law(-1)[1]).toBeCloseTo(39 / 400, 12);
    expect(d20Law(-1)[20]).toBeCloseTo(1 / 400, 12);
  });
});

describe("loi du bonus", () => {
  it("bonus fixe seul", () => expect(Array.from(bonusLaw(5))).toEqual([[5, 1]]));
  it("+1d4: four equiprobable values", () => {
    const law = bonusLaw(5, [{ number: 1, faces: 4 }]);
    expect(Array.from(law.keys()).sort()).toEqual([6, 7, 8, 9]);
    for ( const p of law.values() ) expect(p).toBeCloseTo(0.25, 12);
  });
  it("-1d4 (Bane)", () => {
    const law = bonusLaw(5, [{ number: 1, faces: 4, sign: -1 }]);
    expect(Math.min(...law.keys())).toBe(1);
    expect(Math.max(...law.keys())).toBe(4);
  });
});

describe("chance de toucher", () => {
  it("normal roll: +5 against AC 15 → 11 to 20, 55 %", () => {
    expect(hitChance({ ac: 15, bonus: 5 }).hit).toBeCloseTo(0.55, 12);
  });
  it("le 1 naturel rate toujours, le 20 touche toujours", () => {
    expect(hitChance({ ac: 2, bonus: 10 }).hit).toBeCloseTo(0.95, 12);
    expect(hitChance({ ac: 40, bonus: 0 }).hit).toBeCloseTo(0.05, 12);
    expect(hitChance({ ac: 40, bonus: 0 }).critical).toBeCloseTo(0.05, 12);
  });
  it("Advantage: 1 - (1 - p)²; Disadvantage: p²", () => {
    const p = 0.55;
    expect(hitChance({ ac: 15, bonus: 5, mode: 1 }).hit).toBeCloseTo(1 - ((1 - p) ** 2), 12);
    expect(hitChance({ ac: 15, bonus: 5, mode: -1 }).hit).toBeCloseTo(p * p, 12);
  });
  it("lowered Critical Hit threshold (Champion, 19): the 19 does not hit automatically, it is a Critical Hit if it hits", () => {
    // CA hors d'atteinte : seul le 20 naturel touche.
    const far = hitChance({ ac: 40, bonus: 0, critical: 19 });
    expect(far.hit).toBeCloseTo(0.05, 12);
    expect(far.critical).toBeCloseTo(0.05, 12);
    // +5 against AC 25: the 19 gives 24, a miss; only the 20 hits.
    expect(hitChance({ ac: 25, bonus: 5, critical: 19 })).toEqual({ hit: 0.05, critical: 0.05 });
    // +5 contre CA 15 : touche sur 10 et plus (55 %), critique sur 19 et 20 (10 %).
    const near = hitChance({ ac: 15, bonus: 5, critical: 19 });
    expect(near.hit).toBeCloseTo(0.55, 12);
    expect(near.critical).toBeCloseTo(0.10, 12);
  });
  it("Bless: +5 +1d4 against AC 15 → 55 % + 2.5 × 5 %", () => {
    expect(hitChance({ ac: 15, bonus: 5, dice: [{ number: 1, faces: 4 }] }).hit).toBeCloseTo(0.675, 12);
  });
  it("abri total : intouchable", () => {
    expect(hitChance({ ac: null, bonus: 20 })).toEqual({ hit: 0, critical: 0 });
  });
  it("automatic Critical Hit: everything that hits is a Critical Hit", () => {
    const r = hitChance({ ac: 10, bonus: 5, autoCritical: true });
    expect(r.critical).toBe(r.hit);
  });
});

describe("affichage", () => {
  it("never 0 nor 100 as long as it is not certain", () => {
    expect(asPercent(0.004)).toBe(1);
    expect(asPercent(0.999)).toBe(99);
    expect(asPercent(0)).toBe(0);
    expect(asPercent(0.55)).toBe(55);
  });
});

import { saveFailChance } from "../module/scripts/core/hitchance.mjs";

describe("save failure chance (§15.3)", () => {
  it("d20 + bonus < DD, sans 1 ni 20 automatiques", () => {
    expect(saveFailChance({ dc: 13, bonus: 2 })).toBeCloseTo(0.5, 10);      // fails on 1 to 10
    expect(saveFailChance({ dc: 25, bonus: 2 })).toBe(1);                   // even a 20 is not enough
    expect(saveFailChance({ dc: 2, bonus: 5 })).toBe(0);                    // even a 1 succeeds
  });
  it("Advantage and Disadvantage", () => {
    expect(saveFailChance({ dc: 13, bonus: 2, mode: 1 })).toBeCloseTo(0.25, 10);
    expect(saveFailChance({ dc: 13, bonus: 2, mode: -1 })).toBeCloseTo(0.75, 10);
  });
  it("bonus dice: Bless +1d4 reduces the failure", () => {
    const blessed = saveFailChance({ dc: 13, bonus: 2, dice: [{ number: 1, faces: 4 }] });
    expect(blessed).toBeCloseTo(0.375, 10);                                 // d4 = 1..4: fails on 9, 8, 7, 6 d20 faces → 30/80
  });
  it("automatic failure and Immunity", () => {
    expect(saveFailChance({ dc: 5, bonus: 10, autoFail: true })).toBe(1);
    expect(saveFailChance({ dc: 30, bonus: 0, immune: true })).toBe(0);
  });
});

describe("what players see of the badge (#247)", () => {
  it("\"full\": everything; \"percent\": without the AC", () => {
    expect(hitChanceShows("full")).toEqual({ percent: true, ac: true, reasons: true });
    expect(hitChanceShows("percent")).toEqual({ percent: true, ac: false, reasons: true });
  });
  it("\"advantage\": the reasons for Advantage and Disadvantage alone — no percentage, no AC", () => {
    expect(hitChanceShows("advantage")).toEqual({ percent: false, ac: false, reasons: true });
  });
  it("\"off\", or an unknown level: nothing", () => {
    expect(hitChanceShows("off")).toEqual({ percent: false, ac: false, reasons: false });
    expect(hitChanceShows("autre")).toEqual({ percent: false, ac: false, reasons: false });
    expect(hitChanceShows(undefined)).toEqual({ percent: false, ac: false, reasons: false });
  });
  it("the setting's levels, from most to least talkative", () => {
    expect(HIT_CHANCE_LEVELS).toEqual(["full", "percent", "advantage", "off"]);
  });
});

