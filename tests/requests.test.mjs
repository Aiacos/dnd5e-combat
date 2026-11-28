/**
 * Requests received from another client (§471): what a player can ask for, and what falls out of the rest.
 * Pure rules of core/requests.mjs.
 */
import { describe, it, expect } from "vitest";
import { needsCheck, fromTrusted, actsFor, cureAllowed, healedHp, grantedTempHp, plainReaction } from "../module/scripts/core/requests.mjs";

describe("who must be checked", () => {
  it("a player, yes; a local call, oneself or a GM, no", () => {
    expect(needsCheck({ isGM: false, isSelf: false })).toBe(true);
    expect(needsCheck(null)).toBe(false);
    expect(needsCheck(undefined)).toBe(false);
    expect(needsCheck({ isGM: false, isSelf: true })).toBe(false);
    expect(needsCheck({ isGM: true, isSelf: false })).toBe(false);
  });
});

describe("only from the GM, only what they own (§472)", () => {
  const player = { isGM: false, isSelf: false, id: "p" };
  const gm = { isGM: true, isSelf: false, id: "g" };
  const mine = { testUserPermission: (user, level) => (user.id === "p") && (level === "OWNER") };
  const theirs = { testUserPermission: () => false };

  it("a GM request: from the GM, from oneself or local passes; from a player, no", () => {
    expect(fromTrusted(gm)).toBe(true);
    expect(fromTrusted(null)).toBe(true);
    expect(fromTrusted({ isGM: false, isSelf: true })).toBe(true);
    expect(fromTrusted(player)).toBe(false);
  });
  it("a player acts only for what they own; the GM and the local call for everything", () => {
    expect(actsFor(player, mine)).toBe(true);
    expect(actsFor(player, theirs)).toBe(false);
    expect(actsFor(player, null)).toBe(false);
    expect(actsFor(gm, theirs)).toBe(true);
    expect(actsFor(null, theirs)).toBe(true);
  });
});

describe("does the item's rule allow the act (cure)", () => {
  const restoration = { cures: ["blinded", "deafened", "paralyzed", "poisoned"] };
  const greater = { cures: ["exhaustion", "petrified"] };
  const potion = { curesAll: ["exhaustion", "poisoned"] };

  it("a condition: only those the item ends", () => {
    expect(cureAllowed(restoration, "paralyzed")).toBe(true);
    expect(cureAllowed(restoration, "stunned")).toBe(false);
    expect(cureAllowed(potion, "poisoned")).toBe(true);
    expect(cureAllowed(null, "paralyzed")).toBe(false);
  });
  it("HP and Temporary Hit Points: only a healing pool or a resurrection", () => {
    expect(cureAllowed(restoration, "hp", 0)).toBe(false);
    expect(cureAllowed(restoration, "temphp", 500)).toBe(false);
    expect(cureAllowed({ healPool: { formula: "2d8" } }, "hp", 12)).toBe(true);
    expect(cureAllowed({ revivesFull: true }, "hp", 40)).toBe(true);
    expect(cureAllowed({ healPool: { temp: true } }, "temphp", 10)).toBe(true);
    expect(cureAllowed({ tempHpPool: 120 }, "temphp", 60)).toBe(true);
    expect(cureAllowed({ healPool: { formula: "2d8" } }, "temphp", 10)).toBe(false);
  });
  it("Exhaustion: one level less (cures) or all (curesAll)", () => {
    expect(cureAllowed(greater, "exhaustion-1")).toBe(true);
    expect(cureAllowed(greater, "exhaustion")).toBe(false);
    expect(cureAllowed(potion, "exhaustion")).toBe(true);
    expect(cureAllowed(restoration, "exhaustion-1")).toBe(false);
  });
  it("curses: only those the item lifts", () => {
    const remove = { endsCurses: ["bestow-curse", "hex"] };
    expect(cureAllowed(remove, "curses", ["hex"])).toBe(true);
    expect(cureAllowed(remove, "curses", ["hex", "bless"])).toBe(false);
    expect(cureAllowed(remove, "curses", [])).toBe(false);
    expect(cureAllowed(remove, "curses", "hex")).toBe(false);
  });
  it("standing up with their Reaction: only Power Word Heal", () => {
    expect(cureAllowed({ standsWithReaction: true }, "standReaction")).toBe(true);
    expect(cureAllowed(restoration, "standReaction")).toBe(false);
  });
});

describe("bounds of the values sent", () => {
  it("a heal does not hurt and does not exceed the maximum", () => {
    const hp = { current: 20, max: 30 };
    expect(healedHp(0, hp)).toBe(20);
    expect(healedHp(25, hp)).toBe(25);
    expect(healedHp(999, hp)).toBe(30);
    expect(healedHp("x", hp)).toBe(20);
  });
  it("positive Temporary Hit Points, at most the known cap", () => {
    expect(grantedTempHp(500, 120)).toBe(120);
    expect(grantedTempHp(40, 120)).toBe(40);
    expect(grantedTempHp(-5)).toBe(0);
    expect(grantedTempHp("x")).toBe(0);
  });
});

describe("a reaction requested by a player", () => {
  const forged = {
    actor: "Actor.pnj", prompt: { key: "NePasReagir", data: {} }, auto: true,
    options: [{ name: "x", activity: "Actor.pnj.Item.i.Activity.a", consume: false, drop: ["JournalEntry.j"],
      usage: { scaling: 3, spell: { slot: "spell3" }, consume: { spellSlot: false }, create: { summons: true }, "dnd5e-combat": { confirmed: true } },
      flags: { readiedRelease: true, cost: "free" } }]
  };

  it("the window is always placed", () => {
    expect(plainReaction(forged).auto).toBe(false);
  });
  it("the use keeps only the legitimate forms (level, already-paid prepared spell, \"Aegis\")", () => {
    const [option] = plainReaction(forged).options;
    expect(option.usage).toEqual({ scaling: 3, spell: { slot: "spell3" }, consume: { spellSlot: false } });
    expect(option.flags).toEqual({ readiedRelease: true });
    expect(option.consume).toBe(false);
    expect(option.activity).toBe(forged.options[0].activity);   // rechecked on the receiver (adapter/reactions.mjs)
  });
  it("an invented slot or level is dropped", () => {
    const [option] = plainReaction({ options: [{ usage: { scaling: 99, spell: { slot: "<img src=x>" } }, flags: { cost: "free" } }] }).options;
    expect(option.usage).toBe(null);
    expect(option.flags).toBeUndefined();
  });
  it("a request without options breaks nothing", () => {
    expect(plainReaction({ actor: "Actor.a" }).options).toEqual([]);
  });
});
