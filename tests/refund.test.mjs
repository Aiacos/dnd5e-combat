import { describe, it, expect } from "vitest";
import { freshBudget, spendUse, refundUse, reactionAvailable } from "../module/scripts/core/turn.mjs";

const own = { isOwnTurn: true, attacksPerAction: 2 };
const weapon = { cost: "action", weaponAttack: true, usesSpellSlot: false };
const spell = { cost: "action", weaponAttack: false, usesSpellSlot: true };
const bonus = { cost: "bonus", weaponAttack: false, usesSpellSlot: false };

describe("refund of a use cancelled before any roll (§15.1)", () => {
  it("a spell: the action and the turn's spell slot come back", () => {
    const before = freshBudget();
    const after = spendUse(before, spell, own);
    expect(refundUse(after, before, after)).toEqual(before);
  });

  it("first weapon attack: the Attack action closes again", () => {
    const before = freshBudget();
    const after = spendUse(before, weapon, own);
    expect(after.attacks).toEqual({ granted: 2, used: 1 });
    expect(refundUse(after, before, after)).toEqual(before);
  });

  it("second attack (Extra Attack): only that attack comes back, the action stays paid", () => {
    const b1 = freshBudget();
    const a1 = spendUse(b1, weapon, own);
    const a2 = spendUse(a1, weapon, own);
    const back = refundUse(a2, a1, a2);
    expect(back).toEqual(a1);
    expect(back.action).toBe(0);
  });

  it("what has been spent since stays spent", () => {
    const before = freshBudget();
    const after = spendUse(before, spell, own);
    const later = spendUse(after, bonus, own);   // action bonus prise ensuite
    const back = refundUse(later, before, after);
    expect(back.action).toBe(1);
    expect(back.slotCast).toBe(false);
    expect(back.bonus).toBe(0);
  });

  it("§19.6: a refunded reaction (several per round) also frees the turn in which it had been taken", () => {
    const before = freshBudget({ reactions: 3 });
    const after = spendUse(before, { cost: "reaction" }, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.2" });
    expect(reactionAvailable(after, "c.1.2")).toBe(false);
    const back = refundUse(after, before, after);
    expect(back).toEqual(before);
    expect(reactionAvailable(back, "c.1.2")).toBe(true);
  });

  it("§19.6: a reaction taken since, in another turn, keeps its mark", () => {
    const before = freshBudget({ reactions: 3 });
    const after = spendUse(before, { cost: "reaction" }, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.2" });
    const later = spendUse(after, { cost: "reaction" }, { isOwnTurn: false, attacksPerAction: 1, turnKey: "c.1.3" });
    const back = refundUse(later, before, after);
    expect(back.reaction).toBe(2);
    expect(back.reactedAt).toBe("c.1.3");
  });
});
