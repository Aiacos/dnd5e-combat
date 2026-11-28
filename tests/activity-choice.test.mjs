import { describe, it, expect } from "vitest";
import { activityToUse } from "../module/scripts/core/activity-choice.mjs";

const act = (id, timed, slot = false) => ({ id, timed, slot });

describe("activity choice answered (§42.1)", () => {
  it("an item the engine does not know: the question stays", () => {
    expect(activityToUse({ activities: [act("cast", true, true), act("lethargy", false)], level: 3, known: false })).toBe(null);
  });
  it("a single activity is cast, the others are follow-ups: that one (Armor of Agathys, Sanctuary)", () => {
    expect(activityToUse({ activities: [act("cast", true, true), act("frost", false)], level: 1, known: true })).toBe("cast");
    // Even in progress: there is nothing else to cast.
    expect(activityToUse({ activities: [act("cast", true, true), act("frost", false)], level: 1, known: true, running: true })).toBe("cast");
  });
  it("slot spell not yet cast: the casting, the only one to spend the slot (Hex, Heat Metal)", () => {
    const hex = [act("bonus", false), act("place", true, true), act("move", true, false)];
    expect(activityToUse({ activities: hex, level: 1, known: true })).toBe("place");
  });
  it("the same spell in progress: recasting or playing the follow-up is a real choice", () => {
    const hex = [act("bonus", false), act("place", true, true), act("move", true, false)];
    expect(activityToUse({ activities: hex, level: 1, known: true, running: true })).toBe(null);
  });
  it("several possible castings: a real choice (Bestow Curse, Wall of Fire, Divine Smite)", () => {
    const curse = [act("a", true, true), act("b", true, true), act("c", true, true)];
    expect(activityToUse({ activities: curse, level: 3, known: true })).toBe(null);
  });
  it("cantrip with two activities that are cast: we ask (Dancing Lights, Produce Flame)", () => {
    expect(activityToUse({ activities: [act("create", true, true), act("move", true, true)], level: 0, known: true })).toBe(null);
  });
  it("Toll the Dead: the activity depends on the target's HP, even without another rule", () => {
    const acts = [act("healthy", true, true), act("wounded", true, true)];
    const byWounds = { healthy: "healthy", wounded: "wounded" };
    expect(activityToUse({ activities: acts, byWounds, wounded: true })).toBe("wounded");
    expect(activityToUse({ activities: acts, byWounds, wounded: false })).toBe("healthy");
    expect(activityToUse({ activities: [act("healthy", true, true)], byWounds, wounded: true })).toBe("healthy");
  });
});

describe("activity choice — the activity the item designates (§45)", () => {
  const toad = [{ id: "damage", timed: true, slot: true }, { id: "corpse", timed: true, slot: true }, { id: "expend", timed: true, slot: true }];
  it("Giant Toad's Swallow: the action that swallows, not the damage nor the corpse's exit", () => {
    expect(activityToUse({ activities: toad, known: true, entry: "expend" })).toBe("expend");
    expect(activityToUse({ activities: toad, known: true })).toBeNull();
  });
  it("a designated activity that is not offered decides nothing", () => {
    expect(activityToUse({ activities: toad, known: true, entry: "absente" })).toBeNull();
  });
});

describe("activity choice — an attack and its follow-ups (§46)", () => {
  const a = (id, type, cost) => ({ id, type, cost, timed: cost, slot: true });
  it("Ghoul's Claw: the attack, the save is chained by the engine", () => {
    expect(activityToUse({ activities: [a("attack", "attack", true), a("save", "save", false)] })).toBe("attack");
  });
  it("Giant Frog's Bite: the attack, not the escape check (special activation)", () => {
    expect(activityToUse({ activities: [a("attack", "attack", true), { id: "check", type: "check", cost: false, timed: true, slot: true }] })).toBe("attack");
  });
  it("two activities that cost an action: the question remains", () => {
    expect(activityToUse({ activities: [a("attack", "attack", true), a("bolt", "save", true)] })).toBeNull();
  });
  it("a single costly activity that is not an attack: the known-items rule decides", () => {
    const list = [a("cast", "save", true), a("after", "damage", false)];
    expect(activityToUse({ activities: list, known: false })).toBeNull();
  });
});

describe("activity choice — free casting (§127)", () => {
  const sleep = [{ id: "free", timed: true, slot: false, free: true }, { id: "slot", timed: true, slot: true }];
  it("Magic Initiate's Sleep without a spell slot: the free casting", () => {
    expect(activityToUse({ activities: sleep, known: true, level: 1, slotLeft: false })).toBe("free");
  });
  it("§230: with a spell slot too, the free casting first", () => {
    expect(activityToUse({ activities: sleep, known: true, level: 1, slotLeft: true })).toBe("free");
  });
  it("§230: two free castings (Find Steed misconfigured): the player chooses", () => {
    const two = [...sleep, { id: "free2", timed: true, slot: false, free: true }];
    expect(activityToUse({ activities: two, known: true, level: 2, slotLeft: true })).toBeNull();
  });
  it("§230 : Appel de destrier — gratuite ordinaire seule valable (la volante demande le niveau 4)", () => {
    const steed = [{ id: "steed", timed: true, slot: true }, { id: "flying", timed: true, slot: true },
      { id: "steedFree", timed: true, slot: false, free: true }, { id: "flyingFree", timed: true, slot: false, free: false }];
    expect(activityToUse({ activities: steed, known: true, level: 2, slotLeft: true })).toBe("steedFree");
  });
  it("the spell already in progress: nothing is chosen for the player", () => {
    expect(activityToUse({ activities: sleep, known: true, level: 1, running: true })).toBeNull();
  });
  it("free casting spent: the spell slot, as before", () => {
    const spent = [{ id: "free", timed: true, slot: false, free: false }, { id: "slot", timed: true, slot: true }];
    expect(activityToUse({ activities: spent, known: true, level: 1, slotLeft: true })).toBe("slot");
  });
});
