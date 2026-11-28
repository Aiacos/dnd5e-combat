/**
 * Empowered Spell (Metamagic, SRD 5.2): 1 Sorcery Point to reroll up to the Charisma modifier in damage dice
 * of a spell (at least one); the new rolls count.
 */
import { describe, it, expect } from "vitest";
import { empoweredPicks, empoweredDeltas } from "../module/scripts/core/empowered.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("empoweredPicks — the dice offered for the reroll", () => {
  const dice = [{ value: 6, faces: 6 }, { value: 1, faces: 6 }, { value: 3, faces: 6 }, { value: 2, faces: 6 },
    { value: 4, faces: 6 }];
  it("the dice at half their maximum or less, the lowest first, at most `count`", () => {
    expect(empoweredPicks(dice, 2)).toEqual([1, 3]);
    expect(empoweredPicks(dice, 5)).toEqual([1, 3, 2]);
  });
  it("at least one die, even with a zero or negative modifier", () => {
    expect(empoweredPicks(dice, 0)).toEqual([1]);
    expect(empoweredPicks(dice, -2)).toEqual([1]);
  });
  it("no low die: nothing to offer", () => {
    expect(empoweredPicks([{ value: 5, faces: 6 }, { value: 4, faces: 6 }], 3)).toEqual([]);
    expect(empoweredPicks([], 3)).toEqual([]);
  });
  it("at equal relative value, the die with the larger faces", () => {
    expect(empoweredPicks([{ value: 2, faces: 4 }, { value: 5, faces: 10 }], 1)).toEqual([1]);
  });
});

describe("empoweredDeltas — what changes in the aggregate, per part", () => {
  it("dice of the same type and the same properties are combined", () => {
    const picked = [{ type: "fire", properties: ["mgc"], value: 1 }, { type: "fire", properties: ["mgc"], value: 2 },
      { type: "cold", properties: [], value: 1 }];
    expect(empoweredDeltas(picked, [5, 6, 3])).toEqual([
      { type: "fire", properties: ["mgc"], old: 3, now: 11 }, { type: "cold", properties: [], old: 1, now: 3 }]);
  });
  it("a new lower roll counts too", () => {
    expect(empoweredDeltas([{ type: "fire", properties: [], value: 3 }], [1]))
      .toEqual([{ type: "fire", properties: [], old: 3, now: 1 }]);
  });
});

describe("the entry and the schema", () => {
  it("Empowered Spell", () => {
    expect(CONTENT["empowered-spell"])
      .toEqual({ spellDamageRerolls: { activity: "NkEwJOEFigqsdbZy", count: "max(1, @abilities.cha.mod)" } });
    expect(validateEntry(CONTENT["empowered-spell"])).toEqual([]);
  });
  it("refused forms", () => {
    expect(validateEntry({ spellDamageRerolls: { activity: "NkEwJOEFigqsdbZy" } }).length).toBe(1);
    expect(validateEntry({ spellDamageRerolls: { activity: "court", count: "1" } }).length).toBe(1);
  });
});
