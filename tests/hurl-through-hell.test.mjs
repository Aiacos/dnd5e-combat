/**
 * Projection à travers l'enfer (Occultiste, Fiélon 14 — SRD 5.2) : une fois par tour sur un coup qui touche, une sauvegarde de
 * Charisme ; sur un échec, 8d10 psychiques et Neutralisé jusqu'à la fin du prochain tour de l'Occultiste.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { effectEndsNow } from "../module/scripts/core/effect-ends.mjs";

describe("Projection à travers l'enfer", () => {
  const entry = CONTENT["hurl-through-hell"];
  it("la sauvegarde de l'item proposée sur un coup, une fois par tour", () => {
    expect(entry.hitRider).toEqual({ save: "vIY5Deb2vCh5POdP", oncePerTurn: true });
    expect(validateEntry(entry)).toEqual([]);
  });
  it("Neutralisé cesse à la fin du prochain tour de l'Occultiste, pas à la fin du tour du coup", () => {
    // L'effet posé vient du pack d'effets commun (`uuid` dans l'activité) : la règle le suit par son état.
    const when = entry.effectEnds["status:incapacitated"];
    expect(when).toBe("casterTurnEnd");
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow(when, { casterEnded: true, placedInEnded: false })).toBe(true);
  });
});
