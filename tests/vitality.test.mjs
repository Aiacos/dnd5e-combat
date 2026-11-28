/**
 * Improved Blessed Strikes (Cleric 14, SRD 5.2), Potent Spellcasting: after a Cleric cantrip that dealt damage,
 * Temporary Hit Points (twice the Wisdom modifier) to the caster or to another creature within 18 m.
 */
import { describe, it, expect } from "vitest";
import { vitalityApplies, vitalityRecipients, vitalityGain } from "../module/scripts/core/vitality.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("vitalityApplies", () => {
  const rule = { class: "cleric", requires: ["blessed-strikes-potent-spellcasting", "potent-spellcasting"] };
  it("a Cleric cantrip that hurt a creature, with Potent Spellcasting chosen", () => {
    expect(vitalityApplies(rule, { cantripOfClass: true, damaged: 1, features: ["potent-spellcasting", "channel-divinity"] }))
      .toBe(true);
  });
  it("not without damage, not another spell, not with Divine Strike chosen", () => {
    expect(vitalityApplies(rule, { cantripOfClass: true, damaged: 0, features: ["potent-spellcasting"] })).toBe(false);
    expect(vitalityApplies(rule, { cantripOfClass: false, damaged: 2, features: ["potent-spellcasting"] })).toBe(false);
    expect(vitalityApplies(rule, { cantripOfClass: true, damaged: 1, features: ["divine-strike"] })).toBe(false);
    expect(vitalityApplies(null, { cantripOfClass: true, damaged: 1, features: [] })).toBe(false);
  });
});

describe("vitalityRecipients", () => {
  const tokens = [{ id: "far", name: "Loin", distance: 80, ally: true }, { id: "foe", name: "Ennemi", distance: 10, ally: false },
    { id: "b", name: "Allié B", distance: 40, ally: true }, { id: "a", name: "Allié A", distance: 10, ally: true },
    { id: "me", name: "Clerc", distance: 0, ally: true, self: true }];
  it("the caster first, then the creatures on its side in range, from nearest to farthest", () => {
    expect(vitalityRecipients(tokens, 60).map(t => t.id)).toEqual(["me", "a", "b"]);
  });
  it("the list is bounded", () => {
    expect(vitalityRecipients(tokens, 60, 2).map(t => t.id)).toEqual(["me", "a"]);
  });
});

describe("vitalityGain", () => {
  it("Temporary Hit Points do not stack", () => {
    expect(vitalityGain(8, 0)).toBe(8);
    expect(vitalityGain(8, 5)).toBe(8);
    expect(vitalityGain(8, 8)).toBe(0);
    expect(vitalityGain(8, 12)).toBe(0);
    expect(vitalityGain(0, 0)).toBe(0);
  });
});

describe("the entry and the schema", () => {
  it("Improved Blessed Strikes", () => {
    const entry = CONTENT["improved-blessed-strikes"];
    expect(entry.cantripVitality).toEqual({ class: "cleric", tempHp: "2 * @abilities.wis.mod", range: { value: 60, units: "ft" },
      requires: ["blessed-strikes-potent-spellcasting", "potent-spellcasting"] });
    expect(validateEntry(entry)).toEqual([]);
    expect(validateEntry({ cantripVitality: { class: "cleric", tempHp: "4" } }).length).toBe(1);
  });
});
