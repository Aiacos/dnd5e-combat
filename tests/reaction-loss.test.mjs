import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { cannotReact, costsReaction, loseReaction } from "../module/scripts/core/reaction-loss.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

describe("§501 (B21) : « elle ne perd qu'une réaction »", () => {
  it("schéma : reactions { perRound, loseOne: true }", () => {
    expect(validateEntry({ reactions: { perRound: 3 } })).toEqual([]);
    expect(validateEntry({ reactions: { perRound: 5, loseOne: true } })).toEqual([]);
    expect(validateEntry({ reactions: { perRound: 3, loseOne: false } })).toEqual([expect.stringContaining("reactions")]);
    expect(validateEntry({ reactions: { perRound: 3, autre: true } })).toEqual([expect.stringContaining("reactions")]);
    expect(validateEntry({ reactions: { loseOne: true } })).toEqual([expect.stringContaining("reactions")]);
  });
  it("peut-elle réagir ? Neutralisé ou effet noReactions : non, sauf loseOne ; morte, inconsciente, pétrifiée : jamais", () => {
    expect(cannotReact({ statuses: [] })).toBe(false);
    expect(cannotReact({ statuses: ["incapacitated"] })).toBe(true);
    expect(cannotReact({ blocked: true })).toBe(true);
    expect(cannotReact({ statuses: ["incapacitated", "stunned"], loseOne: true })).toBe(false);
    expect(cannotReact({ blocked: true, loseOne: true })).toBe(false);
    for ( const s of ["dead", "unconscious", "petrified"] ) expect(cannotReact({ statuses: [s, "incapacitated"], loseOne: true })).toBe(true);
  });
  it("quel effet coûte une réaction", () => {
    expect(costsReaction({ statuses: ["incapacitated"] })).toBe(true);
    expect(costsReaction({ statuses: ["stunned", "incapacitated"] })).toBe(true);
    expect(costsReaction({ statuses: ["stunned"] })).toBe(true);
    expect(costsReaction({ blocks: true })).toBe(true);
    expect(costsReaction({ statuses: ["poisoned"] })).toBe(false);
    expect(costsReaction({ statuses: ["incapacitated"], actorStatuses: ["dead"] })).toBe(false);
    expect(costsReaction({ statuses: ["unconscious", "incapacitated"] })).toBe(false);
  });
  it("une réaction en moins, jamais sous 0 ; son pour la table", () => {
    expect(loseReaction({ reaction: 3, action: 1 })).toEqual({ budget: { reaction: 2, action: 1 }, lost: true, left: 2 });
    expect(loseReaction({ reaction: 0 })).toEqual({ budget: { reaction: 0 }, lost: false, left: 0 });
    expect(actionSound("reactionLost", "failure")).toBeTruthy();
  });
});
