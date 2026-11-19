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
