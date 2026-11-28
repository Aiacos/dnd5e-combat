import { describe, it, expect } from "vitest";
import {
  freshBudget, costOf, checkUse, spendUse, dash, disengage, dodge, toggleResource, movementAllowance, basicAction, refundUse,
  turnWentBack
} from "../module/scripts/core/turn.mjs";
import { rangeIssue } from "../module/scripts/core/range.mjs";

const spell = { cost: "action", weaponAttack: false, usesSpellSlot: true };
const cantrip = { cost: "action", weaponAttack: false, usesSpellSlot: false };
const sword = { cost: "action", weaponAttack: true, usesSpellSlot: false };
const bonusSpell = { cost: "bonus", weaponAttack: false, usesSpellSlot: true };
const shield = { cost: "reaction", weaponAttack: false, usesSpellSlot: true };
const mine = { isOwnTurn: true, attacksPerAction: 1 };
const theirs = { isOwnTurn: false, attacksPerAction: 1 };

describe("cost", () => {
  it("only counts action, Bonus Action and Reaction", () => {
    expect(["action", "bonus", "reaction", "minute", "legendary", "special", ""].map(costOf))
      .toEqual(["action", "bonus", "reaction", null, null, null, null]);
  });
  it("an activity outside the budget never causes a problem and costs nothing", () => {
    const free = { cost: null, weaponAttack: false, usesSpellSlot: false };
    expect(checkUse(freshBudget(), free, theirs)).toEqual([]);
    expect(spendUse(freshBudget(), free, mine)).toEqual(freshBudget());
  });
});

describe("legality", () => {
  it("everything is allowed at the start of the turn", () => {
    expect(checkUse(freshBudget(), spell, mine)).toEqual([]);
  });
  it("flags an action already spent", () => {
    expect(checkUse(spendUse(freshBudget(), cantrip, mine), cantrip, mine)).toEqual(["noAction"]);
  });
  it("flags an action outside its turn, but not a Reaction", () => {
    expect(checkUse(freshBudget(), sword, theirs)).toEqual(["notYourTurn"]);
    expect(checkUse(freshBudget(), shield, theirs)).toEqual([]);
  });
  it("flags a Reaction already spent", () => {
    expect(checkUse(spendUse(freshBudget(), shield, theirs), shield, theirs)).toEqual(["noReaction"]);
  });
  it("2024 rule: only one spell slot spell per turn", () => {
    const after = spendUse(freshBudget(), bonusSpell, mine);
    expect(checkUse(after, spell, mine)).toEqual(["slotAlreadyCast"]);
    expect(checkUse(after, cantrip, mine)).toEqual([]);
  });
  it("Shield on another's turn does not use up the spell of its own turn", () => {
    const after = spendUse(freshBudget(), shield, theirs);
    expect(after.slotCast).toBe(false);
  });
});

describe("action Attaquer et attaques multiples", () => {
  const fighter = { isOwnTurn: true, attacksPerAction: 2 };

  it("the first attack pays for the action and opens the following ones", () => {
    const after = spendUse(freshBudget(), sword, fighter);
    expect(after).toMatchObject({ action: 0, attacks: { granted: 2, used: 1 } });
    expect(checkUse(after, sword, fighter)).toEqual([]);
  });
  it("the second attack costs nothing more, the third is flagged", () => {
    const after = spendUse(spendUse(freshBudget(), sword, fighter), sword, fighter);
    expect(after.attacks).toEqual({ granted: 2, used: 2 });
    expect(checkUse(after, sword, fighter)).toEqual(["noAction"]);
  });
  it("an extra attack does not cover a spell", () => {
    expect(checkUse(spendUse(freshBudget(), sword, fighter), cantrip, fighter)).toEqual(["noAction"]);
  });
  it("without Extra Attack, a single attack", () => {
    expect(checkUse(spendUse(freshBudget(), sword, mine), sword, mine)).toEqual(["noAction"]);
  });
  it("a confirmed expense beyond the budget does not go below zero", () => {
    const after = spendUse(spendUse(freshBudget(), cantrip, mine), cantrip, mine);
    expect(after.action).toBe(0);
  });
});

describe("Dash, corrections, movement", () => {
  it("Dash costs the action and doubles movement", () => {
    const after = dash(freshBudget());
    expect(after).toMatchObject({ action: 0, dashed: true });
    expect(movementAllowance(after, 9)).toBe(18);
    expect(movementAllowance(freshBudget(), 9)).toBe(9);
  });
  it("Disengage costs the action, only once", () => {
    const after = disengage(freshBudget());
    expect(after).toMatchObject({ action: 0, disengaged: true });
    expect(disengage(after)).toBe(after);
  });
  it("Dodge costs the action, only once", () => {
    const after = dodge(freshBudget());
    expect(after).toMatchObject({ action: 0, dodging: true });
    expect(dodge(after)).toBe(after);
  });
  it("Foncer sans action disponible ne change rien", () => {
    const spent = spendUse(freshBudget(), cantrip, mine);
    expect(dash(spent)).toBe(spent);
  });
  it("a pip is corrected by hand in both directions", () => {
    const off = toggleResource(freshBudget(), "bonus");
    expect(off.bonus).toBe(0);
    expect(toggleResource(off, "bonus").bonus).toBe(1);
  });
  it("ne modifie jamais le budget d'origine", () => {
    const budget = freshBudget();
    spendUse(budget, sword, { isOwnTurn: true, attacksPerAction: 2 });
    dash(budget);
    expect(budget).toEqual(freshBudget());
  });
});

describe("range", () => {
  const factors = { ft: 1, m: 10 / 3 };
  const m = value => ({ value, units: "m" });

  it("a bow in feet in a metric world: normal range, long range, out of range", () => {
    const bow = { value: 80, long: 320, units: "ft" };   // 24 m / 96 m
    expect(rangeIssue(m(24), bow, factors)).toBeNull();
    expect(rangeIssue(m(25.5), bow, factors)).toBe("longRange");
    expect(rangeIssue(m(97.5), bow, factors)).toBe("outOfRange");
  });
  it("a reach of 1.5 m hits the neighboring cell, not the next one", () => {
    const reach = { value: 1.5, units: "m" };
    expect(rangeIssue(m(1.5), reach, factors)).toBeNull();
    expect(rangeIssue(m(3), reach, factors)).toBe("outOfRange");
  });
  it("says nothing about a range without a value (self, touch, special)", () => {
    expect(rangeIssue(m(30), { value: null, units: "self" }, factors)).toBeNull();
    expect(rangeIssue(m(30), { value: 10, units: "spec" }, factors)).toBeNull();
  });
});

describe("free cost (§16.27)", () => {
  it("a chained ray or a bounce asks for nothing, even off-turn or after a spell slot spell", () => {
    const budget = { ...freshBudget(), action: 0, slotCast: true };
    expect(checkUse(budget, { cost: "free", usesSpellSlot: true, weaponAttack: false }, { isOwnTurn: false })).toEqual([]);
  });
});

import { standUpCost } from "../module/scripts/core/turn.mjs";

describe("§17.2 : se relever", () => {
  it("costs half the speed, if enough remains", () => {
    expect(standUpCost({ speed: 30, remaining: 30 })).toEqual({ cost: 15, issue: null });
    expect(standUpCost({ speed: 30, remaining: 15 })).toEqual({ cost: 15, issue: null });
    expect(standUpCost({ speed: 30, remaining: 10 })).toEqual({ cost: 15, issue: "noMovement" });
    expect(standUpCost({ speed: 0, remaining: Infinity }).issue).toBe("noSpeed");
    expect(standUpCost({ speed: 30, remaining: Infinity }).issue).toBe(null);
  });
});

describe("§19.6: several Reactions per round, one per turn", () => {
  it("three Reactions, but not two in the same game turn", () => {
    let b = freshBudget({ reactions: 3 });
    const r = { cost: "reaction", weaponAttack: false, usesSpellSlot: false };
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.0" })).toEqual([]);
    b = spendUse(b, r, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.0" });
    expect(b.reaction).toBe(2);
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.0" })).toEqual(["noReaction"]);
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.1" })).toEqual([]);
  });
  it("a single Reaction: the ordinary rule", () => {
    let b = freshBudget();
    const r = { cost: "reaction", weaponAttack: false, usesSpellSlot: false };
    b = spendUse(b, r, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.0" });
    expect(checkUse(b, r, { isOwnTurn: false, turnKey: "c.1.1" })).toEqual(["noReaction"]);
  });
});

describe("§157: Haste's limited action", () => {
  const hasted = () => ({ ...freshBudget(), limited: 1 });
  const extra = { isOwnTurn: true, attacksPerAction: 2 };
  it("the action taken, a single extra weapon attack — even with Extra Attack", () => {
    let b = spendUse(hasted(), sword, extra);
    b = spendUse(b, sword, extra);
    expect(b.action).toBe(0);
    expect(checkUse(b, sword, mine)).toEqual([]);
    b = spendUse(b, sword, extra);
    expect(b.limited).toBe(0);
    expect(b.attacks).toEqual({ granted: 1, used: 1 });
    expect(checkUse(b, sword, mine)).toEqual(["noAction"]);
  });
  it("ni sort ni autre action", () => {
    const b = { ...spendUse(hasted(), cantrip, mine) };
    expect(checkUse(b, cantrip, mine)).toEqual(["noAction"]);
  });
  it("Dash, Disengage, Hide — not Dodge", () => {
    const b = { ...hasted(), action: 0 };
    expect(checkUse(b, { ...cantrip, basic: "dash" }, mine)).toEqual([]);
    expect(checkUse(b, { ...cantrip, basic: "hide" }, mine)).toEqual([]);
    expect(checkUse(b, { ...cantrip, basic: "dodge" }, mine)).toEqual(["noAction"]);
    expect(basicAction(b, "dash")).toMatchObject({ limited: 0, dashed: true, action: 0 });
    expect(basicAction(b, "dodge")).toMatchObject({ limited: 1, dodging: true });
  });
  it("B10 : Utiliser un objet non magique", () => {
    const b = { ...hasted(), action: 0 };
    const kit = { ...cantrip, utilize: true };
    expect(checkUse(b, kit, mine)).toEqual([]);
    expect(spendUse(b, kit, mine)).toMatchObject({ limited: 0, action: 0 });
    expect(checkUse({ ...b, limited: 0 }, kit, mine)).toEqual(["noAction"]);
  });
  it("the action first, the limited one next; returned with a cancellation", () => {
    const before = hasted();
    const after = spendUse(before, cantrip, mine);
    expect(after).toMatchObject({ action: 0, limited: 1 });
    const used = spendUse(after, sword, mine);
    expect(refundUse(used, after, used)).toMatchObject({ limited: 1 });
  });
});

describe("§236: Swift Step", () => {
  const rage = { cost: "bonus", weaponAttack: false, usesSpellSlot: false, fleetStep: "opens" };
  const step = { cost: "bonus", weaponAttack: false, usesSpellSlot: false, fleetStep: "free" };
  it("a Bonus Action opens Step of the Wind, free once", () => {
    const after = spendUse(freshBudget(), rage, mine);
    expect(after.bonus).toBe(0);
    expect(after.fleetStep).toBe(true);
    expect(checkUse(after, step, mine)).toEqual([]);
    const stepped = spendUse(after, step, mine);
    expect(stepped.fleetStep).toBe(false);
    expect(stepped.bonus).toBe(0);
    expect(checkUse(stepped, step, mine)).toEqual(["noBonus"]);
  });
  it("Step of the Wind itself opens nothing; without the rule, nothing changes", () => {
    expect(spendUse(freshBudget(), step, mine).fleetStep).toBeFalsy();
    expect(spendUse(freshBudget(), { ...rage, fleetStep: null }, mine).fleetStep).toBeFalsy();
  });
  it("a cancelled use gives back the offered Step of the Wind, or closes it again", () => {
    const before = spendUse(freshBudget(), rage, mine);
    const after = spendUse(before, step, mine);
    expect(refundUse(after, before, after).fleetStep).toBe(true);
    expect(refundUse(before, freshBudget(), before).fleetStep).toBe(false);
  });
});

import { tooClose } from "../module/scripts/core/range.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("O8h (§351): minimum range of siege weapons", () => {
  const factors = { ft: 1, m: 1 / 0.3 };
  it("at 18 m or less: too close; beyond: no", () => {
    expect(tooClose({ value: 60, units: "ft" }, { value: 60, units: "ft" }, factors)).toBe(true);
    expect(tooClose({ value: 30, units: "ft" }, { value: 60, units: "ft" }, factors)).toBe(true);
    expect(tooClose({ value: 65, units: "ft" }, { value: 60, units: "ft" }, factors)).toBe(false);
  });
  it("without a minimum range or an unknown unit: never too close", () => {
    expect(tooClose({ value: 5, units: "ft" }, null, factors)).toBe(false);
    expect(tooClose({ value: 5, units: "ft" }, { value: 60, units: "league" }, factors)).toBe(false);
  });
  it("validation : minRange", () => {
    expect(validateEntry({ minRange: { value: 60, units: "ft" } })).toEqual([]);
    expect(validateEntry({ minRange: { value: 0, units: "ft" } }).length).toBe(1);
    expect(validateEntry({ minRange: { value: 60 } }).length).toBe(1);
  });
});

describe("§402: each Dash adds the Speed", () => {
  it("Swift Retreat (Dash as a Bonus Action) then Dash with the action: three times the Speed", async () => {
    const { basicAction, movementAllowance, freshBudget, addDash } = await import("../module/scripts/core/turn.mjs");
    const bonusDash = addDash(freshBudget());
    expect(movementAllowance(bonusDash, 30)).toBe(60);
    const both = basicAction(bonusDash, "dash");
    expect(both).toMatchObject({ action: 0, dashed: true, dashes: 2 });
    expect(movementAllowance(both, 30)).toBe(90);
  });
  it("un budget d'avant le compte (drapeau seul) vaut un Foncer", async () => {
    const { movementAllowance, freshBudget } = await import("../module/scripts/core/turn.mjs");
    expect(movementAllowance({ ...freshBudget(), dashed: true }, 30)).toBe(60);
  });
});

describe("sens du passage de tour", () => {
  const at = (round, turn) => ({ round, turn, combatantId: "x" });
  it("tour suivant, round suivant : le combat avance", () => {
    expect(turnWentBack(at(1, 0), at(1, 1))).toBe(false);
    expect(turnWentBack(at(1, 2), at(2, 0))).toBe(false);
  });
  it("previous turn, previous round: the combat goes back", () => {
    expect(turnWentBack(at(1, 2), at(1, 1))).toBe(true);
    expect(turnWentBack(at(2, 0), at(1, 2))).toBe(true);
  });
  it("combat start, same turn, missing data: nothing went back", () => {
    expect(turnWentBack({ round: null, turn: null }, at(1, 0))).toBe(false);
    expect(turnWentBack({ round: 0, turn: null }, at(1, 0))).toBe(false);
    expect(turnWentBack(at(1, 1), at(1, 1))).toBe(false);
    expect(turnWentBack(null, at(1, 0))).toBe(false);
    expect(turnWentBack(at(1, 0), null)).toBe(false);
  });
});
