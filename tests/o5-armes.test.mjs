import { describe, it, expect } from "vitest";
import { freshBudget, checkUse, spendUse } from "../module/scripts/core/turn.mjs";
import { attackModifiers } from "../module/scripts/core/conditions.mjs";
import { rangedFeatsFor } from "../module/scripts/core/feats.mjs";

const crossbow = { cost: "action", weaponAttack: true, loading: true };
const sword = { cost: "action", weaponAttack: true };
const ctx = { isOwnTurn: true, attacksPerAction: 2 };

describe("O5a (§339): Loading property", () => {
  it("a Loading weapon fires only once per Attack action, even with Extra Attack", () => {
    let b = freshBudget();
    expect(checkUse(b, crossbow, ctx)).toEqual([]);
    b = spendUse(b, crossbow, ctx);
    expect(b.loadedFired).toBe(true);
    expect(checkUse(b, crossbow, ctx)).toContain("loading");
    // The second attack with another weapon is still allowed.
    expect(checkUse(b, sword, ctx)).toEqual([]);
  });

  it("a sword then the crossbow: a single shot, allowed", () => {
    let b = spendUse(freshBudget(), sword, ctx);
    expect(b.loadedFired).toBe(false);
    expect(checkUse(b, crossbow, ctx)).toEqual([]);
    b = spendUse(b, crossbow, ctx);
    expect(b.attacks.used).toBe(2);
  });

  it("without Loading (Crossbow Expert), two shots", () => {
    const free = { ...crossbow, loading: false };
    const b = spendUse(freshBudget(), free, ctx);
    expect(checkUse(b, free, ctx)).toEqual([]);
  });

  it("Crossbow Expert lifts Loading for crossbows only", () => {
    const rules = [{ kind: "crossbow", loading: true }];
    expect(rangedFeatsFor(rules, { weapon: true, ranged: true, crossbow: true, spell: false }).loading).toBe(true);
    expect(rangedFeatsFor(rules, { weapon: true, ranged: true, crossbow: false, spell: false }).loading).toBe(false);
  });
});

describe("O5a (§339): Heavy property", () => {
  it("Disadvantage when the score is below 13", () => {
    const base = { attacker: [], target: [], adjacent: true, ranged: false };
    expect(attackModifiers({ ...base, heavyTooWeak: true }).disadvantage.map(r => r.key)).toContain("heavyWeapon");
    expect(attackModifiers({ ...base, heavyTooWeak: false }).disadvantage).toEqual([]);
  });
});

describe("O5b (§340): the item that enchants a weapon", () => {
  it("is recognized by the id of the enchantment effect, and not if it is disabled or of another type", async () => {
    const { enchantmentSourcesOf } = await import("../module/scripts/adapter/content.mjs");
    const ench = (id, extra={}) => ({ id, type: "enchantment", disabled: false, ...extra });
    expect(enchantmentSourcesOf({ effects: [ench("ZveR6kPKafjcwQdY")] })).toEqual(["dragon-slayer"]);
    expect(enchantmentSourcesOf({ effects: [ench("ZveR6kPKafjcwQdY", { disabled: true })] })).toEqual([]);
    expect(enchantmentSourcesOf({ effects: [{ id: "ZveR6kPKafjcwQdY", type: "base", disabled: false }] })).toEqual([]);
    expect(enchantmentSourcesOf({ effects: {} })).toEqual([]);
  });

  it("each \"-enchanted\" rule has its item in the enchantment table", async () => {
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    const { ENCHANTMENT_SOURCES } = await import("../module/scripts/content/sources.mjs");
    const sources = new Set(Object.values(ENCHANTMENT_SOURCES));
    for ( const key of Object.keys(CONTENT).filter(k => k.endsWith("-enchanted")) ) expect(sources.has(key.replace(/-enchanted$/, "")), key).toBe(true);
  });
});

describe("O7 (§343): condition \"no armor or shield\"", () => {
  it("holds without armor or shield, fails with either", async () => {
    const { effectHolds } = await import("../module/scripts/core/feats.mjs");
    expect(effectHolds({ unarmored: true }, { armor: null, shield: false })).toBe(true);
    expect(effectHolds({ unarmored: true }, { armor: "light", shield: false })).toBe(false);
    expect(effectHolds({ unarmored: true }, { armor: null, shield: true })).toBe(false);
  });
});
