import { describe, it, expect } from "vitest";
import { potionChoice, chosenPotionMode, costForPotionMode, POTION_MODES } from "../module/scripts/core/potion-choice.mjs";
import { maximizeDice } from "../module/scripts/core/max-dice.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

describe("potions de soins : action Bonus ou action (issue #31)", () => {
  it("hors combat : soin maximal sans question", () => {
    expect(potionChoice({ inCombat: false })).toEqual({ ask: false, mode: "action", available: { bonus: true, action: true } });
  });

  it("en combat, action et action Bonus libres : la question", () => {
    expect(potionChoice({ inCombat: true, budget: { action: 1, bonus: 1 } })).toMatchObject({ ask: true, mode: null });
  });

  it("in combat, a single free resource: that one, automatically", () => {
    expect(potionChoice({ inCombat: true, budget: { action: 1, bonus: 0 } })).toMatchObject({ ask: false, mode: "action",
      available: { bonus: false, action: true } });
    expect(potionChoice({ inCombat: true, budget: { action: 0, bonus: 1 } })).toMatchObject({ ask: false, mode: "bonus",
      available: { bonus: true, action: false } });
  });

  it("in combat, nothing free: the 2024 rule (legality will say what is missing)", () => {
    expect(potionChoice({ inCombat: true, budget: { action: 0, bonus: 0 } })).toMatchObject({ ask: false, mode: "bonus" });
  });

  it("unknown budget in combat: both are offered", () => {
    expect(potionChoice({ inCombat: true, budget: null })).toMatchObject({ ask: true });
  });

  it("a choice passed by the caller is kept only if it is known", () => {
    expect(POTION_MODES).toEqual(["bonus", "action"]);
    expect(chosenPotionMode("action")).toBe("action");
    expect(chosenPotionMode("bonus")).toBe("bonus");
    expect(chosenPotionMode("reaction")).toBeNull();
    expect(chosenPotionMode(undefined)).toBeNull();
  });

  it("the action costs the action; the Bonus Action keeps the data's cost", () => {
    expect(costForPotionMode("action")).toBe("action");
    expect(costForPotionMode("bonus")).toBeNull();
  });

  it("maximum healing of healing potions (formula set to maximum before the roll)", () => {
    const total = f => Function(`return ${maximizeDice(f)}`)();
    expect(total("2d4 + 2")).toBe(10);
    expect(total("4d4 + 4")).toBe(20);
    expect(total("8d4 + 8")).toBe(40);
    expect(total("10d4 + 20")).toBe(60);
  });

  it("a sound for maximum healing, seen and heard by the whole table", () => {
    expect(actionSound("potionMax", "success")).toBeTruthy();
    expect(actionSound("potionMax", "failure")).toBeNull();
  });
});
