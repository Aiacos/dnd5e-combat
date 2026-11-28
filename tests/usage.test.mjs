import { describe, it, expect } from "vitest";
import { pickSpellSlot, misplacedSelfUses, canCastHigher, forcedSpellSlot, atCastLevel, followUpScaling, castLevelUsage, spellCastLevel } from "../module/scripts/core/usage.mjs";

describe("§68: the slot of a use without a dialog", () => {
  const slots = { spell1: { value: 0, level: 1 }, spell2: { value: 2, level: 2 }, spell3: { value: 1, level: 3 }, pact: { value: 1, level: 2 } };
  it("celui que dnd5e propose, s'il en reste", () => expect(pickSpellSlot(slots, "spell2", 1)).toBe("spell2"));
  it("otherwise the lowest one that still has some (the ordinary slot before the pact at equal level)", () => {
    expect(pickSpellSlot(slots, "spell1", 1)).toBe("spell2");
    expect(pickSpellSlot({ ...slots, spell2: { value: 0, level: 2 } }, "spell1", 1)).toBe("pact");
  });
  it("jamais en dessous du niveau du sort", () => expect(pickSpellSlot(slots, "spell1", 3)).toBe("spell3"));
  it("null : plus aucun emplacement", () => {
    expect(pickSpellSlot({ spell1: { value: 0, level: 1 }, pact: { value: 0, level: 1 } }, "spell1", 1)).toBeNull();
  });
});

describe("§77: the activity's uses placed on the item", () => {
  const self = [{ type: "activityUses", target: "" }, { type: "itemUses", target: "" }, { type: "activityUses", target: "aaaaaaaaaaaaaaaa" }];
  it("the activity without a maximum, the item with one: its own uses become the item's", () => expect(misplacedSelfUses(self, false, true)).toEqual([0]));
  it("sinon rien", () => {
    expect(misplacedSelfUses(self, true, true)).toEqual([]);
    expect(misplacedSelfUses(self, false, false)).toEqual([]);
  });
});

describe("§106: a spell castable higher keeps the dnd5e dialog", () => {
  const slots = { spell1: { value: 2, level: 1 }, spell2: { value: 0, level: 2 }, spell3: { value: 1, level: 3 }, pact: { value: 0, level: 3 } };
  it("un emplacement plus haut reste", () => expect(canCastHigher(slots, 1)).toBe(true));
  it("nothing above the spell's level", () => expect(canCastHigher(slots, 3)).toBe(false));
  it("empty slots do not count", () => expect(canCastHigher({ ...slots, spell3: { value: 0, level: 3 } }, 1)).toBe(false));
  it("the pact counts, at its level", () => expect(canCastHigher({ spell1: { value: 0, level: 1 }, pact: { value: 1, level: 3 } }, 2)).toBe(true));
});

describe("§384: a spell higher than the pact slot (issue #38, Create Undead)", () => {
  const warlock = { pact: { value: 2, max: 2, level: 3 }, spell6: { value: 0, max: 0, level: 6 } };
  it("the level 3 pact slot does not cast a level 6 spell", () => {
    expect(pickSpellSlot(warlock, "pact", 6)).toBeNull();
    expect(pickSpellSlot(warlock, "pact", 3)).toBe("pact");
    expect(pickSpellSlot(warlock, "pact", 1)).toBe("pact");
  });
  it("cast anyway by the GM: at the spell's level", () => {
    expect(forcedSpellSlot(warlock, "pact", 6)).toBe("spell6");
    expect(forcedSpellSlot(warlock, "pact", 3)).toBe("pact");
    expect(forcedSpellSlot({ spell5: { level: 5 } }, "spell5", 5)).toBe("spell5");
    expect(forcedSpellSlot({ spell7: { level: 7 } }, "spell7", 5)).toBe("spell7");
  });
  it("nothing for a cantrip or without an offered slot", () => {
    expect(forcedSpellSlot(warlock, "pact", 0)).toBeNull();
    expect(forcedSpellSlot(warlock, null, 6)).toBeNull();
  });
});

describe("§404: the activity at the casting level", () => {
  // A dummy item: `scaledClone(n)` returns a copy whose activity carries the upcast.
  const itemOf = calls => {
    const item = {
      scaledClone: n => {
        calls.push(n);
        const clone = { flags: { scaling: n } };
        clone.system = { activities: new Map([["atk", { id: "atk", item: clone, dice: 3 + n }]]) };
        return clone;
      }
    };
    return item;
  };
  it("a slot upcast → the scaled copy, same id", () => {
    const calls = [];
    const activity = { id: "atk", item: itemOf(calls), dice: 3 };
    const scaled = atCastLevel(activity, 2);
    expect(calls).toEqual([2]);
    expect(scaled.id).toBe("atk");
    expect(scaled.dice).toBe(5);
  });
  it("an upcast read from a message (string) is converted", () => {
    const calls = [];
    expect(atCastLevel({ id: "atk", item: itemOf(calls), dice: 3 }, "1").dice).toBe(4);
  });
  it("without upcast, negative or unreadable: the activity as is, without a clone", () => {
    const calls = [];
    const activity = { id: "atk", item: itemOf(calls), dice: 3 };
    for ( const s of [0, null, undefined, -1, "x"] ) expect(atCastLevel(activity, s)).toBe(activity);
    expect(calls).toEqual([]);
  });
  it("without `scaledClone` (activity of a non-item object) or without activity: unchanged", () => {
    const bare = { id: "atk", item: {} };
    expect(atCastLevel(bare, 2)).toBe(bare);
    expect(atCastLevel(null, 2)).toBeNull();
  });
  it("the activity missing from the copy: the original activity", () => {
    const activity = { id: "autre", item: itemOf([]) };
    expect(atCastLevel(activity, 1)).toBe(activity);
  });
});

describe("§405: an activity of a spell without a slot, at its Concentration level", () => {
  it("Flame Blade cast at level 4: the next attack at +2, level 4 slot (nothing is spent)", () => {
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, scaling: 0, concentrationScaling: 2 })).toEqual({ scaling: 2, slot: "spell4" });
  });
  it("an upcast read from an effect (string) is converted", () => {
    expect(followUpScaling({ spellLevel: 1, consumesSlot: false, concentrationScaling: "1" })).toEqual({ scaling: 1, slot: "spell2" });
  });
  it("nothing: activity that spends a slot, upcast already set, Concentration at base level or absent, cantrip", () => {
    expect(followUpScaling({ spellLevel: 2, consumesSlot: true, concentrationScaling: 2 })).toBeNull();
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, scaling: 1, concentrationScaling: 2 })).toBeNull();
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, concentrationScaling: 0 })).toBeNull();
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false })).toBeNull();
    expect(followUpScaling({ spellLevel: 0, consumesSlot: false, concentrationScaling: 2 })).toBeNull();
  });
  it("`scaling: false` (dnd5e, scaling forbidden) does not prevent the resumption", () => {
    expect(followUpScaling({ spellLevel: 2, consumesSlot: false, scaling: false, concentrationScaling: 1 })).toEqual({ scaling: 1, slot: "spell3" });
  });
});

describe("§406: an activity replayed by the engine at the casting level (castLevelUsage)", () => {
  it("Delayed Blast Fireball cast at level 9 (level 7 spell, upcast 2): upcast and slot of that level", () => {
    expect(castLevelUsage(7, 2)).toEqual({ scaling: 2, spell: { slot: "spell9" } });
    expect(castLevelUsage("3", "1")).toEqual({ scaling: 1, spell: { slot: "spell4" } });
  });
  it("nothing without an upcast, nor for a cantrip", () => {
    expect(castLevelUsage(7, 0)).toEqual({});
    expect(castLevelUsage(7, undefined)).toEqual({});
    expect(castLevelUsage(0, 2)).toEqual({});
  });
});

describe("§406: the casting level read from a scaled copy (spellCastLevel)", () => {
  it("spell level + upcast (`flags.dnd5e.scaling`); the spell level alone without an upcast", () => {
    expect(spellCastLevel({ system: { level: 1 }, flags: { dnd5e: { scaling: 2 } } })).toBe(3);
    expect(spellCastLevel({ system: { level: 3 }, flags: {} })).toBe(3);
    expect(spellCastLevel(null)).toBe(0);
  });
});
