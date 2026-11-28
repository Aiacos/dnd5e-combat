import { describe, it, expect } from "vitest";
import { searchRollMode, normalTotal, searchVerdicts, passiveNotice, searchBonuses } from "../module/scripts/core/search.mjs";
import { wornOrNotEquipment } from "../module/scripts/adapter/triggers.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("mode du test de Chercher", () => {
  it("Disadvantage as soon as a hiding place to be judged by the roll is in perceived Dim Light", () => {
    expect(searchRollMode([{ seeable: true }])).toBe("normal");
    expect(searchRollMode([{ seeable: true }, { seeable: true, disadvantage: true }])).toBe("disadvantage");
  });
  it("a hiding place perceived by the senses or out of sight does not count", () => {
    expect(searchRollMode([{ sensed: true, seeable: true, disadvantage: true }, { seeable: false, disadvantage: true }])).toBe("normal");
  });
  it("aucune cachette : test normal", () => {
    expect(searchRollMode([])).toBe("normal");
  });
});

describe("total without Disadvantage", () => {
  it("keeps the first d20 of a check with Disadvantage", () => {
    // 2d20kl: 17 and 4, 4 kept, +5 → 9; without Disadvantage: 17 + 5 = 22.
    expect(normalTotal({ total: 9, d20: [17, 4], kept: 4 })).toBe(22);
    // First d20 kept: identical.
    expect(normalTotal({ total: 8, d20: [3, 12], kept: 3 })).toBe(8);
  });
  it("a check with a single d20 is already without Disadvantage", () => {
    expect(normalTotal({ total: 14, d20: [], kept: null })).toBe(14);
  });
});

describe("verdicts", () => {
  const roll = { total: 9, d20: [17, 4], kept: 4 };   // 9 with Disadvantage, 22 without
  it("in Bright Light, the total without Disadvantage; in Dim Light, the total with Disadvantage", () => {
    const v = searchVerdicts([
      { id: "a", dc: 15, seeable: true },
      { id: "b", dc: 15, seeable: true, disadvantage: true }
    ], roll);
    expect(v).toEqual([
      { id: "a", found: true, reason: "roll", total: 22, dc: 15 },
      { id: "b", found: false, reason: "roll", total: 9, dc: 15 }
    ]);
  });
  it("atteindre le DD suffit", () => {
    expect(searchVerdicts([{ id: "a", dc: 14, seeable: true }], { total: 14 })[0].found).toBe(true);
  });
  it("out of sight: never found; perceived by the senses: found without a roll", () => {
    const v = searchVerdicts([{ id: "a", dc: 5, seeable: false }, { id: "b", dc: 30, sensed: true }], { total: 20 });
    expect(v).toEqual([
      { id: "a", found: false, reason: "unseen", dc: 5 },
      { id: "b", found: true, reason: "senses", dc: 30 }
    ]);
  });
});

describe("Perception passive", () => {
  it("reaching the DC is enough; −5 in perceived Dim Light", () => {
    expect(passiveNotice({ passive: 15, seeable: true }, 15)).toEqual({ notices: true, score: 15 });
    expect(passiveNotice({ passive: 15, seeable: true, disadvantage: true }, 15)).toEqual({ notices: false, score: 10 });
    expect(passiveNotice({ passive: 20, seeable: true, disadvantage: true }, 15)).toEqual({ notices: true, score: 15 });
  });
  it("out of sight: never; perceived by the senses: always", () => {
    expect(passiveNotice({ passive: 30, seeable: false }, 5)).toEqual({ notices: false, score: null });
    expect(passiveNotice({ passive: 1, sensed: true }, 30)).toEqual({ notices: true, score: null });
  });
  it("sans valeur passive, rien", () => {
    expect(passiveNotice({ passive: undefined, seeable: true }, 5).notices).toBe(false);
  });
});

describe("what adds to the Search check (searchBonus)", () => {
  const eyes = { rule: { advantage: true } };
  it("a worn item gives Advantage; in the bag, or unattuned when it requires it, nothing", () => {
    const worn = { type: "equipment", system: { equipped: true, attunement: "" } };
    const packed = { type: "equipment", system: { equipped: false, attunement: "" } };
    const unattuned = { type: "equipment", system: { equipped: true, attunement: "required", attuned: false } };
    const attuned = { type: "equipment", system: { equipped: true, attunement: "required", attuned: true } };
    const keenOf = item => searchBonuses([{ ...eyes, item, counts: wornOrNotEquipment(item) }]).keen?.item ?? null;
    expect(keenOf(worn)).toBe(worn);
    expect(keenOf(packed)).toBeNull();
    expect(keenOf(unattuned)).toBeNull();
    expect(keenOf(attuned)).toBe(attuned);
  });
  it("a feature always counts; its Advantage with uses requires that one remain", () => {
    const feat = { type: "feat", system: {} };
    expect(searchBonuses([{ ...eyes, counts: wornOrNotEquipment(feat) }]).keen).not.toBeNull();
    expect(searchBonuses([{ ...eyes, counts: true, usesMax: 2, usesLeft: 0 }]).keen).toBeNull();
    expect(searchBonuses([{ ...eyes, counts: true, usesMax: 2, usesLeft: 1 }]).keen).not.toBeNull();
  });
  it("the dice add up, without those of a stowed item", () => {
    const sources = [{ rule: { formula: "1d4" }, counts: true }, { rule: { formula: "1d6" }, counts: false },
      { rule: null, counts: true }];
    expect(searchBonuses(sources)).toEqual({ parts: ["1d4"], keen: null });
    expect(searchBonuses([])).toEqual({ parts: [], keen: null });
  });
  it("content: Eyes of the Eagle and Robe of Eyes", () => {
    for ( const id of ["eyes-of-the-eagle", "robe-of-eyes"] ) {
      expect(CONTENT[id].searchBonus, id).toEqual({ advantage: true });
      expect(validateEntry(CONTENT[id]), id).toEqual([]);
    }
  });
});
