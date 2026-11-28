import { describe, it, expect } from "vitest";
import { sneakAttackIssue, parseDice, sneakDiceAtLevel, affordableStrikes, settleStrikes, hasNotActedYet } from "../module/scripts/core/sneak.mjs";
import { open, advance, applicationPlan } from "../module/scripts/core/action.mjs";
import { attackModifiers } from "../module/scripts/core/conditions.mjs";
import { usageLimitIssues } from "../module/scripts/core/limits.mjs";
import { movementAllowance, freshBudget } from "../module/scripts/core/turn.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

describe("§20 Attaque sournoise : quand elle s'applique", () => {
  const ok = { weapon: true, finesse: true, rangedWeapon: false, advantageMode: 1, allyNear: false };
  it("arme de Finesse avec l'Avantage", () => expect(sneakAttackIssue(ok)).toBe(null));
  it("ranged weapon, without Advantage but an ally 1.50 m from the target", () => {
    expect(sneakAttackIssue({ ...ok, finesse: false, rangedWeapon: true, advantageMode: 0, allyNear: true })).toBe(null);
  });
  it("ally nearby but Disadvantage: no", () => expect(sneakAttackIssue({ ...ok, advantageMode: -1, allyNear: true })).toBe("disadvantage"));
  it("neither Advantage nor ally: no", () => expect(sneakAttackIssue({ ...ok, advantageMode: 0 })).toBe("noAdvantage"));
  it("weapon neither Finesse nor ranged (axe, thrown spear): no", () => expect(sneakAttackIssue({ ...ok, finesse: false })).toBe("weaponKind"));
  it("a spell or an unarmed attack: no", () => expect(sneakAttackIssue({ ...ok, weapon: false })).toBe("notWeapon"));
  it("already used this turn: no", () => expect(sneakAttackIssue({ ...ok, spent: true })).toBe("spent"));
});

describe("§20 Sneak Attack: the dice", () => {
  it("the scale formula, or the level", () => {
    expect(parseDice("3d6")).toEqual({ number: 3, faces: 6 });
    expect(parseDice(" 10d6 ")).toEqual({ number: 10, faces: 6 });
    expect(parseDice("@scale.rogue.sneak-attack")).toBe(null);
    expect(sneakDiceAtLevel(1)).toEqual({ number: 1, faces: 6 });
    expect(sneakDiceAtLevel(5)).toEqual({ number: 3, faces: 6 });
    expect(sneakDiceAtLevel(20)).toEqual({ number: 10, faces: 6 });
    expect(sneakDiceAtLevel(0)).toBe(null);
  });
});

describe("§20 Cunning Strike", () => {
  const options = [
    { key: "poison", cost: 1, available: false }, { key: "trip", cost: 1 }, { key: "withdraw", cost: 1 },
    { key: "daze", cost: 2 }, { key: "knockOut", cost: 6 }, { key: "obscure", cost: 3 }
  ];
  it("only what can be paid for, and what is possible (poisoner's kit)", () => {
    expect(affordableStrikes(options, 3).map(o => o.key)).toEqual(["trip", "withdraw", "daze", "obscure"]);
    expect(affordableStrikes(options, 1).map(o => o.key)).toEqual(["trip", "withdraw"]);
  });
  it("one effect at level 5: the second is dropped", () => {
    expect(settleStrikes(["trip", "withdraw"], affordableStrikes(options, 3), { dice: 3, max: 1 })).toEqual({ strikes: ["trip"], cost: 1, dice: 2 });
  });
  it("two effects at level 11, within the limit of the dice; not the same twice", () => {
    const opts = affordableStrikes(options, 6);
    expect(settleStrikes(["trip", "withdraw"], opts, { dice: 6, max: 2 })).toEqual({ strikes: ["trip", "withdraw"], cost: 2, dice: 4 });
    expect(settleStrikes(["trip", "trip"], opts, { dice: 6, max: 2 })).toEqual({ strikes: ["trip"], cost: 1, dice: 5 });
    expect(settleStrikes(["knockOut", "trip"], opts, { dice: 6, max: 2 })).toEqual({ strikes: ["knockOut"], cost: 6, dice: 0 });
    expect(settleStrikes(["inconnu"], opts, { dice: 6, max: 2 })).toEqual({ strikes: [], cost: 0, dice: 6 });
  });
});

describe("§20 Assassinate: a creature that has not yet played", () => {
  it("first round only, those that come after the current turn", () => {
    expect(hasNotActedYet({ round: 1, turn: 0, targetTurn: 2 })).toBe(true);
    expect(hasNotActedYet({ round: 1, turn: 2, targetTurn: 1 })).toBe(false);
    expect(hasNotActedYet({ round: 1, turn: 2, targetTurn: 2 })).toBe(false);
    expect(hasNotActedYet({ round: 2, turn: 0, targetTurn: 3 })).toBe(false);
    expect(hasNotActedYet({ round: 1, turn: 1, targetTurn: null })).toBe(true);
  });
});

describe("§20 Esquive totale", () => {
  const base = RESOLUTION_BASE;
  const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
  const multipliers = (save, targets, totals) => {
    let { resolution } = open({ ...base, plan: { save, damage: "author", effects: [] }, targets });
    totals.forEach((total, i) => ({ resolution } = advance(resolution, { type: "saveRolled", actor: `A${i + 1}`, total, messageId: `s${i}` })));
    return applicationPlan(resolution).map(e => e.multiplier);
  };
  const dex = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  it("Dexterity saving throw for half: nothing on a success, half on a failure", () => {
    expect(multipliers(dex, [T(1, { evasion: true }), T(2, { evasion: true }), T(3)], [20, 3, 20])).toEqual([0, 0.5, 0.5]);
  });
  it("not for another ability, nor for a save without half", () => {
    expect(multipliers({ ...dex, ability: "con" }, [T(1, { evasion: true })], [3])).toEqual([1]);
    expect(multipliers({ ...dex, onSave: "none" }, [T(1, { evasion: true })], [20])).toEqual([0]);
    expect(multipliers({ ...dex, onSave: "none" }, [T(1, { evasion: true })], [3])).toEqual([1]);
  });
});

describe("§20 Insaisissable", () => {
  const ctx = { attacker: ["hidden"], target: ["prone"], adjacent: true, ranged: false, declared: { advantage: ["Tactique de meute"], disadvantage: [] } };
  it("no reason for Advantage counts; Disadvantage does", () => {
    expect(attackModifiers(ctx).advantage.length).toBeGreaterThan(0);
    const elusive = attackModifiers({ ...ctx, elusive: true, attacker: ["restrained"] });
    expect(elusive.advantage).toEqual([]);
    expect(elusive.disadvantage.map(r => r.key)).toEqual(["restrained"]);
  });
});

describe("§20 Steady Aim and Withdraw", () => {
  it("\"if you haven't moved during this turn\" — in combat", () => {
    const state = { inCombat: true, ownTurn: true, usedThisTurn: false, remaining: null };
    expect(usageLimitIssues({ unmoved: true }, { ...state, moved: true })).toEqual(["moved"]);
    expect(usageLimitIssues({ unmoved: true }, { ...state, moved: false })).toEqual([]);
    expect(usageLimitIssues({ unmoved: true }, { ...state, inCombat: false, moved: true })).toEqual([]);
  });
  it("Withdraw opens up half the Speed in addition; Dash does not double it", () => {
    expect(movementAllowance({ ...freshBudget(), bonusMove: 15 }, 30)).toBe(45);
    expect(movementAllowance({ ...freshBudget(), dashed: true, bonusMove: 15 }, 30)).toBe(75);
    expect(movementAllowance(freshBudget(), 30)).toBe(30);
  });
});

describe("§20 Rogue schema and content", () => {
  it("the new keys", () => {
    expect(validateEntry({ sneakAttack: true, evasion: true, elusive: true, holdsStill: true, cunningStrikeMax: 2 })).toEqual([]);
    expect(validateEntry({ sneakBonus: { formula: "@classes.rogue.levels", firstRound: true } })).toEqual([]);
    expect(validateEntry({ cunningStrikes: { trip: { cost: 1, activity: "dWcCw1vTWRMx4YzD", sizeAtMost: "lg" }, withdraw: { cost: 1, withdraw: true } } })).toEqual([]);
    expect(validateEntry({ cunningStrikes: { x: { cost: 0 } } })).toEqual(["cunningStrikes.x.cost: positive integer (dice)", "cunningStrikes.x: an activity, withdraw or keepsHidden"]);
    expect(validateEntry({ cunningStrikes: { x: { cost: 1, withdraw: true, sizeAtMost: "big" } } })).toEqual(["cunningStrikes.x.sizeAtMost: tiny, sm, med, lg, huge, grg"]);
    expect(validateEntry({ basicActions: { NiI5qEhg9TepZxMh: "hide" } })).toEqual([]);
    expect(validateEntry({ basicActions: { NiI5qEhg9TepZxMh: "fly" } })).toEqual(["basicActions.NiI5qEhg9TepZxMh: dash, disengage, dodge, hide, help (or a list)"]);
    expect(validateEntry({ usageLimits: { VGVYnecMRcu0f5Sq: { unmoved: true } } })).toEqual([]);
  });
  it("the shipped content", () => {
    expect(CONTENT["sneak-attack"].sneakAttack).toBe(true);
    expect(Object.keys(CONTENT["cunning-strike"].cunningStrikes)).toEqual(["poison", "trip", "withdraw"]);
    expect(Object.keys(CONTENT["devious-strikes"].cunningStrikes)).toEqual(["daze", "knockOut", "obscure"]);
    expect(CONTENT["improved-cunning-strike"].cunningStrikeMax).toBe(2);
    expect(CONTENT["cunning-action"].basicActions).toEqual({ NtS3iThuWWwm8O62: "dash", AeCciDTvw3kS583a: "disengage", NiI5qEhg9TepZxMh: "hide" });
    expect(CONTENT["steady-aim"].holdsStill).toBe(true);
    expect(CONTENT.evasion.evasion).toBe(true);
    expect(CONTENT.elusive.elusive).toBe(true);
    expect(CONTENT.assassinate.sneakBonus).toEqual({ formula: "@classes.rogue.levels", firstRound: true });
    // Uncanny Dodge stays where it was (trigger table).
    expect(CONTENT["uncanny-dodge"].triggers[0].on).toBe("isHit");
  });
});

describe("§72 : Attaque sournoise d'un PNJ", () => {
  const base = { weapon: true, finesse: false, rangedWeapon: false, advantageMode: 0, allyNear: false };
  it("toute arme (anyWeapon), avec l'Avantage", () => expect(sneakAttackIssue({ ...base, anyWeapon: true, advantageMode: 1 })).toBe(null));
  it("no anyWeapon, weapon neither Finesse nor ranged: no", () => expect(sneakAttackIssue({ ...base, advantageMode: 1 })).toBe("weaponKind"));
  it("against an Undead (freeTarget): no Advantage or ally required", () => expect(sneakAttackIssue({ ...base, anyWeapon: true, freeTarget: true })).toBe(null));
  it("already used this turn: no, even against an Undead", () => expect(sneakAttackIssue({ ...base, anyWeapon: true, freeTarget: true, spent: true })).toBe("spent"));
});
