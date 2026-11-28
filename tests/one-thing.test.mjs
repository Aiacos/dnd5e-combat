/**
 * Dazed (Rogue 14, Devious Strikes — SRD 5.2): on the target's turn, only one thing among moving, taking an action, taking a
 * Bonus Action.
 */
import { describe, it, expect } from "vitest";
import { oneThingBudget, oneThingStopsMove } from "../module/scripts/core/one-thing.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const fresh = { action: 1, bonus: 1, reaction: 1, limited: 0 };

describe("oneThingBudget", () => {
  it("rien de fait : tout reste ouvert", () => {
    expect(oneThingBudget({ ...fresh }, fresh, false)).toEqual(fresh);
  });
  it("moved: neither action nor Bonus Action", () => {
    expect(oneThingBudget({ ...fresh }, fresh, true)).toMatchObject({ action: 0, bonus: 0 });
  });
  it("an action taken: no Bonus Action; a Bonus Action taken: no action", () => {
    expect(oneThingBudget({ ...fresh, action: 0 }, fresh, false)).toMatchObject({ action: 0, bonus: 0 });
    expect(oneThingBudget({ ...fresh, bonus: 0 }, fresh, false)).toMatchObject({ action: 0, bonus: 0 });
  });
  it("the Reaction is not affected", () => {
    expect(oneThingBudget({ ...fresh }, fresh, true).reaction).toBe(1);
  });
});

describe("oneThingStopsMove", () => {
  it("an action or a Bonus Action taken: no more movement", () => {
    expect(oneThingStopsMove({ ...fresh }, fresh)).toBe(false);
    expect(oneThingStopsMove({ ...fresh, action: 0 }, fresh)).toBe(true);
    expect(oneThingStopsMove({ ...fresh, bonus: 0 }, fresh)).toBe(true);
  });
});

describe("the entry", () => {
  it("Devious Strikes: the \"Dazed\" effect carries the rule, until the end of the target's next turn", () => {
    const entry = CONTENT["devious-strikes"];
    expect(entry.oneThingPerTurn).toBe("wWFV1p8u9C1TUPg5");
    expect(entry.effectEnds).toEqual({ wWFV1p8u9C1TUPg5: "bearerTurnEnd" });
    expect(validateEntry(entry)).toEqual([]);
    expect(validateEntry({ oneThingPerTurn: "court" }).length).toBe(1);
  });
});
