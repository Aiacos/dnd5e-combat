/**
 * Voile de la nature (Rôdeur 14, SRD 5.2) : l'état Invisible « jusqu'à la fin de votre prochain tour ». L'effet « Veiled » de
 * l'item n'a pas de durée dans la donnée : vu en jeu, il restait après la fin du tour suivant.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { effectEndsNow } from "../module/scripts/core/effect-ends.mjs";

describe("Voile de la nature", () => {
  it("l'effet de l'item finit à la fin du prochain tour du Rôdeur", () => {
    expect(CONTENT["natures-veil"].effectEnds).toEqual({ NOSQczI2MCQ5Ha8F: "casterTurnEnd" });
    expect(validateEntry(CONTENT["natures-veil"])).toEqual([]);
  });
  it("pas à la fin du tour où il est posé, ni au tour d'un autre", () => {
    const when = CONTENT["natures-veil"].effectEnds.NOSQczI2MCQ5Ha8F;
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow(when, { casterEnded: false, placedInEnded: false })).toBe(false);
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: false })).toBe(true);
  });
});
