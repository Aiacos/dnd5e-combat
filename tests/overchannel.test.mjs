/**
 * Overchannel (Wizard, Evoker 14 — SRD 5.2): maximum damage of a wizard spell cast with a level 1 to 5 spell slot, on the turn
 * it is cast; from the second use before a Long Rest, a necrotic backlash per spell slot level.
 */
import { describe, it, expect } from "vitest";
import { overchannelApplies, maximizedDeltas, backlashDice } from "../module/scripts/core/overchannel.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("overchannelApplies", () => {
  const rule = { class: "wizard", maxLevel: 5, die: 12 };
  const cast = (over={}) => ({ isSpell: true, baseLevel: 1, castLevel: 1, sourceClass: "wizard", ...over });
  it("a wizard spell, cast with a level 1 to 5 spell slot", () => {
    expect(overchannelApplies(rule, cast())).toBe(true);
    expect(overchannelApplies(rule, cast({ baseLevel: 3, castLevel: 5 }))).toBe(true);
    expect(overchannelApplies(rule, cast({ baseLevel: 3, castLevel: 6 }))).toBe(false);
  });
  it("not a cantrip, not a spell of another class, not anything other than a spell", () => {
    expect(overchannelApplies(rule, cast({ baseLevel: 0, castLevel: 0 }))).toBe(false);
    expect(overchannelApplies(rule, cast({ sourceClass: "cleric" }))).toBe(false);
    expect(overchannelApplies(rule, cast({ isSpell: false }))).toBe(false);
    expect(overchannelApplies(null, cast())).toBe(false);
  });
  it("a spell whose class is not recorded is allowed", () => {
    expect(overchannelApplies(rule, cast({ sourceClass: null }))).toBe(true);
  });
});

describe("maximizedDeltas", () => {
  it("each part goes to the maximum of its dice; a part already at the maximum does not change", () => {
    const dice = [{ type: "fire", properties: [], value: 2, faces: 6 }, { type: "fire", properties: [], value: 6, faces: 6 },
      { type: "cold", properties: [], value: 8, faces: 8 }];
    expect(maximizedDeltas(dice)).toEqual([{ type: "fire", properties: [], old: 8, now: 12 }]);
    expect(maximizedDeltas([])).toEqual([]);
  });
});

describe("backlashDice — le contrecoup", () => {
  it("nothing the first time; 2d12 per level the second, 3d12 the third", () => {
    expect(backlashDice(1, 5)).toBe(0);
    expect(backlashDice(2, 1)).toBe(2);
    expect(backlashDice(2, 3)).toBe(6);
    expect(backlashDice(3, 3)).toBe(9);
    expect(backlashDice(4, 5)).toBe(20);
  });
});

describe("the entry and the schema", () => {
  it("Surcharge", () => {
    expect(CONTENT["overchannel"]).toEqual({ overchannel: { class: "wizard", maxLevel: 5, die: 12 } });
    expect(validateEntry(CONTENT["overchannel"])).toEqual([]);
    expect(validateEntry({ overchannel: { maxLevel: 5 } }).length).toBe(1);
    expect(validateEntry({ overchannel: { maxLevel: 0, die: 12 } }).length).toBe(1);
  });
});
