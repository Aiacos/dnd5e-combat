/**
 * The reroll of a missed roll paid for by an activity (`rollBonus.reroll`). Countercharm (Bard 7, SRD 5.2) rerolls the save with
 * Advantage; seen in play, the reroll was a single d20, and its question spoke of "once per Rage".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { rerollFormula } from "../module/scripts/core/reroll.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("rerollFormula", () => {
  it("one d20, two with Advantage, the bonus if there is one", () => {
    expect(rerollFormula({})).toBe("1d20");
    expect(rerollFormula(null)).toBe("1d20");
    expect(rerollFormula({ bonus: "0" })).toBe("1d20");
    expect(rerollFormula({ bonus: "@scale.barbarian.rage-damage" })).toBe("1d20 + @scale.barbarian.rage-damage");
    expect(rerollFormula({ advantage: true })).toBe("2d20kh");
    expect(rerollFormula({ advantage: true, bonus: "2" })).toBe("2d20kh + 2");
  });
});

describe("the schema and the content", () => {
  const paid = reroll => ({ rollBonus: { activity: "dnd5eactivity000", on: ["save"], reroll } });
  it("`advantage: true`: only for a reroll that an activity pays for", () => {
    expect(validateEntry(paid({ advantage: true }))).toEqual([]);
    expect(validateEntry(paid({ advantage: false })).length).toBeGreaterThan(0);
    const unpaid = { rollBonus: { on: ["save"], reroll: { bonus: "1", during: "rage", advantage: true } } };
    expect(validateEntry(unpaid).length).toBeGreaterThan(0);
  });
  it("Contre-charme relance avec l'Avantage", () => {
    expect(CONTENT.countercharm.rollBonus.reroll).toEqual({ advantage: true });
  });
  it("the question of the paid reroll does not mention Rage, and says Advantage", () => {
    for ( const lang of ["en", "fr", "it"] ) {
      const table = JSON.parse(readFileSync(new URL(`../module/lang/${lang}.json`, import.meta.url), "utf8"));
      for ( const key of ["QuestionPayee", "QuestionAvantage"] ) {
        const text = table[`DND5ECOMBAT.Relance.${key}`];
        expect(text, `${lang} ${key}`).toBeTruthy();
        expect(text, `${lang} ${key}`).not.toMatch(/Rage|Ira|rage/);
        expect(text, `${lang} ${key}`).toContain("{item}");
      }
    }
  });
});

describe("a fixed d20 (`sets`) — Stroke of Luck", () => {
  it("the formula: the value, without a die", async () => {
    const { rerollFormula } = await import("../module/scripts/core/reroll.mjs");
    expect(rerollFormula({ sets: 20 })).toBe("20");
  });
  it("offered on a missed roll, or without a known DC; never when the d20 is already as high, nor on a success", async () => {
    const { rerollOffered, rerollQuestion } = await import("../module/scripts/core/reroll.mjs");
    expect(rerollOffered({ sets: 20 }, { d20: 7, total: 12, needed: 15 })).toBe(true);
    expect(rerollOffered({ sets: 20 }, { d20: 7, total: 12, needed: null })).toBe(true);
    expect(rerollOffered({ sets: 20 }, { d20: 20, total: 12, needed: 30 })).toBe(false);
    expect(rerollOffered({ sets: 20 }, { d20: 7, total: 16, needed: 15 })).toBe(false);
    expect(rerollOffered({ sets: 20 }, { d20: null, total: 12, needed: 15 })).toBe(false);
    // An ordinary reroll keeps its behavior: it needs a DC.
    expect(rerollOffered({}, { d20: 7, total: 12, needed: null })).toBe(false);
    expect(rerollOffered({}, { d20: 7, total: 12, needed: 15 })).toBe(true);
    expect(rerollQuestion({ sets: 20 }, 15)).toBe("QuestionFixe");
    expect(rerollQuestion({ sets: 20 }, null)).toBe("QuestionFixeTest");
    expect(rerollQuestion({ advantage: true }, 15)).toBe("QuestionAvantage");
    expect(rerollQuestion({}, 15)).toBe("QuestionPayee");
  });
  it("the schema and the Rogue's entry", async () => {
    const { validateEntry } = await import("../module/scripts/core/content.mjs");
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    const rule = sets => ({ rollBonus: { activity: "y4PG8Ow1eNEle580", on: ["check"], reroll: sets } });
    expect(validateEntry(rule({ sets: 20 }))).toEqual([]);
    expect(validateEntry(rule({ sets: 21 })).length).toBe(1);
    expect(validateEntry(rule({ sets: 20, advantage: true })).length).toBe(1);
    expect(CONTENT["stroke-of-luck"].rollBonus)
      .toEqual({ activity: "y4PG8Ow1eNEle580", on: ["attack", "save", "check"], reroll: { sets: 20 } });
    expect(validateEntry(CONTENT["stroke-of-luck"])).toEqual([]);
  });
});
