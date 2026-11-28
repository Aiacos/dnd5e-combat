/**
 * Divine Intervention (Cleric 10, SRD 5.2): a cleric spell of level 5 or lower, not cast as a Reaction, cast in the same action
 * without a spell slot.
 */
import { describe, it, expect } from "vitest";
import { freeCastApplies, freeCastHeld } from "../module/scripts/core/free-cast.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("freeCastApplies — the spell that takes the free cast", () => {
  const rule = { activity: "dnd5eactivity000", maxLevel: 5, class: "cleric" };
  const spell = (over={}) => ({ isSpell: true, level: 3, activation: "action", sourceClass: "cleric", ...over });
  it("a cleric spell of level 1 to 5, by an action or a Bonus Action", () => {
    expect(freeCastApplies(rule, spell())).toBe(true);
    expect(freeCastApplies(rule, spell({ level: 5, activation: "bonus" }))).toBe(true);
  });
  it("not beyond level 5, not a cantrip, not a Reaction, not a spell of another class", () => {
    expect(freeCastApplies(rule, spell({ level: 6 }))).toBe(false);
    expect(freeCastApplies(rule, spell({ level: 0 }))).toBe(false);
    expect(freeCastApplies(rule, spell({ activation: "reaction" }))).toBe(false);
    expect(freeCastApplies(rule, spell({ sourceClass: "wizard" }))).toBe(false);
    expect(freeCastApplies(rule, spell({ isSpell: false }))).toBe(false);
  });
  it("a spell whose class is not noted is allowed", () => {
    expect(freeCastApplies(rule, spell({ sourceClass: null }))).toBe(true);
  });
});

describe("freeCastHeld — tant que la retenue vaut", () => {
  it("until the end of the turn when it was taken", () => {
    expect(freeCastHeld({ turn: "c.1.0", at: 0 }, { turn: "c.1.0" })).toBe(true);
    expect(freeCastHeld({ turn: "c.1.0", at: 0 }, { turn: "c.1.1" })).toBe(false);
    expect(freeCastHeld({ turn: "c.1.0", at: 0 }, { turn: null })).toBe(false);
  });
  it("hors combat, une minute", () => {
    expect(freeCastHeld({ turn: null, at: 100 }, { turn: null, now: 150 })).toBe(true);
    expect(freeCastHeld({ turn: null, at: 100 }, { turn: null, now: 200 })).toBe(false);
    expect(freeCastHeld(null, {})).toBe(false);
  });
});

describe("the entry and the schema", () => {
  it("Intervention divine", () => {
    expect(CONTENT["divine-intervention"]).toEqual({ freeCast: { activity: "dnd5eactivity000", maxLevel: 5, class: "cleric" } });
    expect(validateEntry(CONTENT["divine-intervention"])).toEqual([]);
    expect(validateEntry({ freeCast: { activity: "dnd5eactivity000" } }).length).toBe(1);
    expect(validateEntry({ freeCast: { activity: "court", maxLevel: 5 } }).length).toBe(1);
  });
});
