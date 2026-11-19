/**
 * Carte en rangées (`chatRows`) : la carte d'une action réglée perd les boutons de jet de dnd5e et son tiroir d'effets ; celle
 * d'une action annulée les garde — le MJ peut vouloir relancer. Et ses infobulles sont du texte, jamais relu comme du HTML.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { settled, STEPS } from "../module/scripts/core/action.mjs";

describe("settled — l'action est réglée pour de bon", () => {
  it("terminée ou manquée : oui", () => {
    expect(settled(STEPS.DONE)).toBe(true);
    expect(settled(STEPS.MISSED)).toBe(true);
  });
  it("annulée, ou encore en cours : non", () => {
    for ( const step of [STEPS.UNDONE, STEPS.AWAITING_ATTACK, STEPS.AWAITING_REACTION, STEPS.AWAITING_ROLLS, undefined] ) {
      expect(settled(step), String(step)).toBe(false);
    }
  });
});

describe("la carte en rangées", () => {
  const source = readFileSync(new URL("../module/scripts/ui/chat.mjs", import.meta.url), "utf8");
  it("n'est élaguée que pour une action réglée", () => {
    expect(source).toMatch(/rowsEnabled\(\) && settled\(step\) \) trimCard\(/);
    expect(source).not.toMatch(/STEPS\.UNDONE\]\.includes\(step\) \) trimCard/);
  });
  it("pose ses infobulles de rangée et de sauvegarde en texte (`tooltipText`)", () => {
    expect(source).toMatch(/li\.dataset\.tooltipText = line\.detail/);
    expect(source).toMatch(/total\.dataset\.tooltipText = /);
    expect(source).not.toMatch(/li\.dataset\.tooltip = line\.detail/);
    expect(source).not.toMatch(/total\.dataset\.tooltip = /);
  });
});
