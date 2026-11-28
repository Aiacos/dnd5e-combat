import { describe, it, expect } from "vitest";
import { eventRounds, eventEnded } from "../module/scripts/core/combat-events.mjs";

describe("§250: events in the Initiative", () => {
  it("from the current round for n rounds; before combat, from round 1", () => {
    expect(eventRounds(1, 1)).toEqual({ from: 1, until: 1 });
    expect(eventRounds(0, 1)).toEqual({ from: 1, until: 1 });
    expect(eventRounds(3, 2)).toEqual({ from: 3, until: 4 });
  });
  it("sans fin : rounds null ou nul", () => {
    expect(eventRounds(2, null)).toEqual({ from: 2, until: null });
    expect(eventRounds(2, 0)).toEqual({ from: 2, until: null });
  });
  it("finished once its last round has been played", () => {
    expect(eventEnded({ until: 1 }, 1)).toBe(true);
    expect(eventEnded({ until: 2 }, 1)).toBe(false);
    expect(eventEnded({ until: null }, 9)).toBe(false);
    expect(eventEnded(null, 1)).toBe(false);
  });
});
