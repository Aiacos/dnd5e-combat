import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { freshBudget, reactionAvailable } from "../module/scripts/core/turn.mjs";

describe("Têtes réactives (Hydre, SRD 5.2) : une Réaction par tête", () => {
  it("cinq Réactions par round", () => {
    expect(CONTENT["reactive-heads"].reactions).toEqual({ perRound: 5 });
  });
  it("le budget les compte, une par tour de jeu au plus", () => {
    const budget = freshBudget({ reactions: CONTENT["reactive-heads"].reactions.perRound });
    expect(budget.reaction).toBe(5);
    expect(reactionAvailable({ ...budget, reaction: 4, reactedAt: "c.1.0" }, "c.1.1")).toBe(true);
    expect(reactionAvailable({ ...budget, reaction: 4, reactedAt: "c.1.1" }, "c.1.1")).toBe(false);
    expect(reactionAvailable({ ...budget, reaction: 0 }, "c.1.2")).toBe(false);
  });
});
