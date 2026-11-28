import { describe, expect, it } from "vitest";
import { takesAnotherTurn, movedForward, validateExtraTurns } from "../module/scripts/core/extra-turns.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("extraTurns: turns in a row (Time Stop)", () => {
  it("the tracker advanced: next round, or a turn further in the same round", () => {
    expect(movedForward({ round: 1, turn: 0 }, { round: 1, turn: 1 })).toBe(true);
    expect(movedForward({ round: 1, turn: 3 }, { round: 2, turn: 0 })).toBe(true);
    expect(movedForward({ round: 2, turn: 0 }, { round: 1, turn: 3 })).toBe(false);
    expect(movedForward({ round: 1, turn: 1 }, { round: 1, turn: 1 })).toBe(false);
    expect(movedForward(null, { round: 1, turn: 0 })).toBe(false);
  });
  it("one more turn while any remain, in this combat, when the tracker advances", () => {
    const state = { combat: "c1", left: 2 };
    expect(takesAnotherTurn(state, { combat: "c1", forward: true })).toBe(true);
    expect(takesAnotherTurn(state, { combat: "c1", forward: false })).toBe(false);
    expect(takesAnotherTurn(state, { combat: "c2", forward: true })).toBe(false);
    expect(takesAnotherTurn({ combat: "c1", left: 0 }, { combat: "c1", forward: true })).toBe(false);
    expect(takesAnotherTurn(null, { combat: "c1", forward: true })).toBe(false);
  });
  it("the key is validated; Time Stop does not use it until issue #274", () => {
    expect(CONTENT["time-stop"]?.extraTurns).toBeUndefined();
    expect(validateExtraTurns({ formula: "1d4 + 1" }, "")).toEqual([]);
    expect(validateExtraTurns({ formula: "" }, "")).toHaveLength(1);
    expect(validateEntry({ extraTurns: { formula: "1d4 + 1", free: true } })).not.toEqual([]);
  });
});
