/**
 * Talent hors pair (Barde, Collège du savoir, niveau 14 — SRD 5.2) : un test de caractéristique ou un jet d'attaque raté, une
 * Inspiration bardique dépensée, le dé ajouté au d20 ; sur un échec, l'Inspiration n'est pas dépensée.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("Talent hors pair", () => {
  it("un dé payé par l'activité de l'item, sur une attaque ou un test, rendu si le jet reste raté", () => {
    const rule = CONTENT["peerless-skill"].rollBonus;
    expect(rule).toEqual({ activity: "dnd5eactivity000", on: ["attack", "check"], failRefund: true });
    expect(validateEntry(CONTENT["peerless-skill"])).toEqual([]);
  });
  it("pas sur une sauvegarde : le texte ne nomme que le test de caractéristique et le jet d'attaque", () => {
    expect(CONTENT["peerless-skill"].rollBonus.on).not.toContain("save");
  });
});

describe("formulaShown — la formule montrée au joueur", () => {
  it("une référence que les données donnent est remplacée ; les autres restent", async () => {
    const { formulaShown } = await import("../module/scripts/core/formula-text.mjs");
    const die = { toString: () => "1d10" };
    expect(formulaShown("@scale.bard.inspiration", { scale: { bard: { inspiration: die } } })).toBe("1d10");
    expect(formulaShown("1d4 + @abilities.cha.mod", { abilities: { cha: { mod: 3 } } })).toBe("1d4 + 3");
    expect(formulaShown("@scale.bard.inspiration", {})).toBe("@scale.bard.inspiration");
    expect(formulaShown("@scale.bard", { scale: { bard: {} } })).toBe("@scale.bard");
    expect(formulaShown("1d10", null)).toBe("1d10");
  });
});
