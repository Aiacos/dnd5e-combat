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

  it("en combat, une seule ressource libre : celle-là, d'office", () => {
    expect(potionChoice({ inCombat: true, budget: { action: 1, bonus: 0 } })).toMatchObject({ ask: false, mode: "action",
      available: { bonus: false, action: true } });
    expect(potionChoice({ inCombat: true, budget: { action: 0, bonus: 1 } })).toMatchObject({ ask: false, mode: "bonus",
      available: { bonus: true, action: false } });
  });

  it("en combat, rien de libre : la règle 2024 (la légalité dira ce qui manque)", () => {
    expect(potionChoice({ inCombat: true, budget: { action: 0, bonus: 0 } })).toMatchObject({ ask: false, mode: "bonus" });
  });

  it("budget inconnu en combat : les deux sont proposées", () => {
    expect(potionChoice({ inCombat: true, budget: null })).toMatchObject({ ask: true });
  });

  it("un choix passé par l'appelant n'est gardé que s'il est connu", () => {
    expect(POTION_MODES).toEqual(["bonus", "action"]);
    expect(chosenPotionMode("action")).toBe("action");
    expect(chosenPotionMode("bonus")).toBe("bonus");
    expect(chosenPotionMode("reaction")).toBeNull();
    expect(chosenPotionMode(undefined)).toBeNull();
  });

  it("l'action coûte l'action ; l'action Bonus garde le coût de la donnée", () => {
    expect(costForPotionMode("action")).toBe("action");
    expect(costForPotionMode("bonus")).toBeNull();
  });

  it("le soin maximal des potions de guérison (formule mise au maximum avant le jet)", () => {
    const total = f => Function(`return ${maximizeDice(f)}`)();
    expect(total("2d4 + 2")).toBe(10);
    expect(total("4d4 + 4")).toBe(20);
    expect(total("8d4 + 8")).toBe(40);
    expect(total("10d4 + 20")).toBe(60);
  });

  it("un son pour le soin maximal, vu et entendu de toute la table", () => {
    expect(actionSound("potionMax", "success")).toBeTruthy();
    expect(actionSound("potionMax", "failure")).toBeNull();
  });
});
