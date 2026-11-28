/**
 * `effectEnds`: when an effect placed by an item ends at a turn change. Seen in play with the `searing-vengeance` entry of the
 * shipped content: an effect that should hold until the end of the current turn, declared `casterTurnEnd` and placed on the
 * caster's turn in round 1, lasted a whole round and only ended at the end of its turn in round 2.
 */
import { describe, it, expect } from "vitest";
import { effectEndsNow } from "../module/scripts/core/effect-ends.mjs";
import { EFFECT_ENDS } from "../module/scripts/core/content/enums.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("effectEndsNow", () => {
  it("currentTurnEnd: at the end of the turn where the effect was placed, whoever's turn it is", () => {
    expect(effectEndsNow("currentTurnEnd", { casterEnded: true, placedInEnded: true })).toBe(true);
    expect(effectEndsNow("currentTurnEnd", { casterEnded: false, bearerEnded: false, placedInEnded: true })).toBe(true);
    // Placed on another turn (out of combat, then combat starts): nothing at this turn change.
    expect(effectEndsNow("currentTurnEnd", { casterEnded: true, bearerEnded: true, placedInEnded: false })).toBe(false);
  });

  it("casterTurnEnd / bearerTurnEnd: not the end of the turn where the effect was placed, the next one", () => {
    expect(effectEndsNow("casterTurnEnd", { casterEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow("casterTurnEnd", { casterEnded: true, placedInEnded: false })).toBe(true);
    expect(effectEndsNow("casterTurnEnd", { bearerEnded: true, placedInEnded: false })).toBe(false);
    expect(effectEndsNow("bearerTurnEnd", { bearerEnded: true, placedInEnded: true })).toBe(false);
    expect(effectEndsNow("bearerTurnEnd", { bearerEnded: true, placedInEnded: false })).toBe(true);
    expect(effectEndsNow("bearerTurnEnd", { casterEnded: true, placedInEnded: false })).toBe(false);
  });

  it("casterTurnStart / bearerTurnStart: at the start of one's turn, the other's", () => {
    expect(effectEndsNow("casterTurnStart", { casterStarts: true })).toBe(true);
    expect(effectEndsNow("casterTurnStart", { bearerStarts: true })).toBe(false);
    expect(effectEndsNow("bearerTurnStart", { bearerStarts: true })).toBe(true);
    expect(effectEndsNow("bearerTurnStart", { casterStarts: true })).toBe(false);
  });

  it("an unknown mode, or nothing about the turn: the effect stays", () => {
    expect(effectEndsNow("whenever", { casterEnded: true, bearerEnded: true, placedInEnded: true })).toBe(false);
    for ( const when of EFFECT_ENDS ) expect(effectEndsNow(when), when).toBe(false);
  });
});

describe("le contenu", () => {
  it("`currentTurnEnd` is a mode of the schema", () => {
    expect(EFFECT_ENDS).toContain("currentTurnEnd");
    expect(validateEntry({ effectEnds: { KOXCayzftTFF9Kam: "currentTurnEnd" } })).toEqual([]);
    expect(validateEntry({ effectEnds: { KOXCayzftTFF9Kam: "thisTurnEnd" } })).not.toEqual([]);
  });
  it("`searing-vengeance`: its effects end at the end of the current turn", () => {
    const ends = CONTENT["searing-vengeance"].effectEnds;
    expect(ends).toEqual({ KOXCayzftTFF9Kam: "currentTurnEnd", "4odkdDU1wBQrCMJ1": "currentTurnEnd" });
  });
});
