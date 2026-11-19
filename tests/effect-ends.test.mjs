/**
 * `effectEnds` : quand un effet posé par un item tombe à un changement de tour. Vu en jeu avec l'entrée `searing-vengeance` du
 * contenu livré : un effet qui doit tenir jusqu'à la fin du tour en cours, déclaré `casterTurnEnd` et posé au tour du lanceur au
 * round 1, tenait un round entier et ne tombait qu'à la fin de son tour du round 2.
 */
import { describe, it, expect } from "vitest";
import { effectEndsNow } from "../module/scripts/core/effect-ends.mjs";
import { EFFECT_ENDS } from "../module/scripts/core/content/enums.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("effectEndsNow", () => {
  it("currentTurnEnd : à la fin du tour où l'effet a été posé, à qui que soit ce tour", () => {
    expect(effectEndsNow("currentTurnEnd", { casterEnded: true, placedInEnded: true })).toBe(true);
    expect(effectEndsNow("currentTurnEnd", { casterEnded: false, bearerEnded: false, placedInEnded: true })).toBe(true);
    // Posé à un autre tour (hors combat, puis le combat commence) : rien à ce changement de tour.
    expect(effectEndsNow("currentTurnEnd", { casterEnded: true, bearerEnded: true, placedInEnded: false })).toBe(false);
  });

  it("casterTurnEnd / bearerTurnEnd : pas la fin du tour où l'effet a été posé, la suivante", () => {
    expect(effectEndsNow("casterTurnEnd", { casterEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow("casterTurnEnd", { casterEnded: true, placedInEnded: false })).toBe(true);
    expect(effectEndsNow("casterTurnEnd", { bearerEnded: true, placedInEnded: false })).toBe(false);
    expect(effectEndsNow("bearerTurnEnd", { bearerEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow("bearerTurnEnd", { bearerEnded: true, placedInEnded: false })).toBe(true);
    expect(effectEndsNow("bearerTurnEnd", { casterEnded: true, placedInEnded: false })).toBe(false);
  });

  it("casterTurnStart / bearerTurnStart : au début du tour de l'un, de l'autre", () => {
    expect(effectEndsNow("casterTurnStart", { casterStarts: true })).toBe(true);
    expect(effectEndsNow("casterTurnStart", { bearerStarts: true })).toBe(false);
    expect(effectEndsNow("bearerTurnStart", { bearerStarts: true })).toBe(true);
    expect(effectEndsNow("bearerTurnStart", { casterStarts: true })).toBe(false);
  });

  it("un mode inconnu, ou rien du tour : l'effet reste", () => {
    expect(effectEndsNow("whenever", { casterEnded: true, bearerEnded: true, placedInEnded: true })).toBe(false);
    for ( const when of EFFECT_ENDS ) expect(effectEndsNow(when), when).toBe(false);
  });
});

describe("le contenu", () => {
  it("`currentTurnEnd` est un mode du schéma", () => {
    expect(EFFECT_ENDS).toContain("currentTurnEnd");
    expect(validateEntry({ effectEnds: { KOXCayzftTFF9Kam: "currentTurnEnd" } })).toEqual([]);
    expect(validateEntry({ effectEnds: { KOXCayzftTFF9Kam: "thisTurnEnd" } })).not.toEqual([]);
  });
  it("`searing-vengeance` : ses effets tombent à la fin du tour en cours", () => {
    const ends = CONTENT["searing-vengeance"].effectEnds;
    expect(ends).toEqual({ KOXCayzftTFF9Kam: "currentTurnEnd", "4odkdDU1wBQrCMJ1": "currentTurnEnd" });
  });
});
