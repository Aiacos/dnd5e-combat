import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { cannotReact, costsReaction, loseReaction } from "../module/scripts/core/reaction-loss.mjs";
import { actionSound } from "../module/scripts/core/action-feedback.mjs";

describe("§501 (B21): \"it loses only one Reaction\"", () => {
  it("schema: reactions { perRound, loseOne: true }", () => {
    expect(validateEntry({ reactions: { perRound: 3 } })).toEqual([]);
    expect(validateEntry({ reactions: { perRound: 5, loseOne: true } })).toEqual([]);
    expect(validateEntry({ reactions: { perRound: 3, loseOne: false } })).toEqual([expect.stringContaining("reactions")]);
    expect(validateEntry({ reactions: { perRound: 3, autre: true } })).toEqual([expect.stringContaining("reactions")]);
    expect(validateEntry({ reactions: { loseOne: true } })).toEqual([expect.stringContaining("reactions")]);
  });
  it("can it react? Incapacitated or noReactions effect: no, except loseOne; dead, Unconscious, Petrified: never", () => {
    expect(cannotReact({ statuses: [] })).toBe(false);
    expect(cannotReact({ statuses: ["incapacitated"] })).toBe(true);
    expect(cannotReact({ blocked: true })).toBe(true);
    expect(cannotReact({ statuses: ["incapacitated", "stunned"], loseOne: true })).toBe(false);
    expect(cannotReact({ blocked: true, loseOne: true })).toBe(false);
    for ( const s of ["dead", "unconscious", "petrified"] ) expect(cannotReact({ statuses: [s, "incapacitated"], loseOne: true })).toBe(true);
  });
  it("which effect costs a Reaction", () => {
    expect(costsReaction({ statuses: ["incapacitated"] })).toBe(true);
    expect(costsReaction({ statuses: ["stunned", "incapacitated"] })).toBe(true);
    expect(costsReaction({ statuses: ["stunned"] })).toBe(true);
    expect(costsReaction({ blocks: true })).toBe(true);
    expect(costsReaction({ statuses: ["poisoned"] })).toBe(false);
    expect(costsReaction({ statuses: ["incapacitated"], actorStatuses: ["dead"] })).toBe(false);
    expect(costsReaction({ statuses: ["unconscious", "incapacitated"] })).toBe(false);
  });
  it("one Reaction fewer, never below 0; sound for the table", () => {
    expect(loseReaction({ reaction: 3, action: 1 })).toEqual({ budget: { reaction: 2, action: 1 }, lost: true, left: 2 });
    expect(loseReaction({ reaction: 0 })).toEqual({ budget: { reaction: 0 }, lost: false, left: 0 });
    expect(actionSound("reactionLost", "failure")).toBeTruthy();
  });
});
