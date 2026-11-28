import { describe, expect, it } from "vitest";
import {
  subtypeMatches, saveDisadvantageAgainstHolds, validateSaveDisadvantageAgainst
} from "../module/scripts/core/eligibility.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("fact target.creatureSubtype: a creature's subtype (Demon Armor)", () => {
  it("case-insensitive; a list = any one of them; no subtype: no", () => {
    expect(subtypeMatches("Demon", "demon")).toBe(true);
    expect(subtypeMatches(" demon ", "Demon")).toBe(true);
    expect(subtypeMatches("Devil", "demon")).toBe(false);
    expect(subtypeMatches("Devil", ["demon", "devil"])).toBe(true);
    expect(subtypeMatches("", "demon")).toBe(false);
    expect(subtypeMatches(null, "demon")).toBe(false);
    expect(subtypeMatches(undefined, [])).toBe(false);
  });
  it("Demon Armor: Disadvantage on the attack roll against a demon, not against a devil", () => {
    const [rule] = ITEM_FIXES["demon-armor-enchanted"].triggers;
    expect(rule.on).toBe("preAttackRoll");
    expect(rule.do).toEqual([{ type: "disadvantage" }]);
    const facts = subtype => ({ "target.creatureSubtype": want => subtypeMatches(subtype, want) });
    expect(holds(rule.if, facts("Demon"))).toBe(true);
    expect(holds(rule.if, facts("Devil"))).toBe(false);
    expect(holds(rule.if, facts(null))).toBe(false);
  });
  it("Demon Armor: Disadvantage on the saves a demon imposes, not a devil", () => {
    const rule = ITEM_FIXES["demon-armor-enchanted"].saveDisadvantageAgainst;
    expect(rule).toEqual({ subtypes: ["demon"] });
    expect(saveDisadvantageAgainstHolds(rule, "Demon")).toBe(true);
    expect(saveDisadvantageAgainstHolds(rule, "Devil")).toBe(false);
    expect(saveDisadvantageAgainstHolds(rule, "")).toBe(false);
    expect(saveDisadvantageAgainstHolds(null, "Demon")).toBe(false);
    expect(validateSaveDisadvantageAgainst(rule, "")).toEqual([]);
    expect(validateSaveDisadvantageAgainst({ subtypes: [] }, "")).toHaveLength(1);
    expect(validateSaveDisadvantageAgainst({ subtypes: ["demon"], types: ["fiend"] }, "")).toHaveLength(1);
    expect(validateEntry({ saveDisadvantageAgainst: rule })).toEqual([]);
  });
});
