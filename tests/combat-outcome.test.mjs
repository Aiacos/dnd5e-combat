import { describe, it, expect } from "vitest";
import { isDefeated, wasPlayed } from "../module/scripts/core/combat-outcome.mjs";

describe("§555: what a combat leaves behind", () => {
  it("dead or marked defeated in the tracker: defeated", () => {
    expect(isDefeated({ dead: true })).toBe(true);
    expect(isDefeated({ tracker: true, hp: 12 })).toBe(true);
    expect(isDefeated({ dead: true, character: true })).toBe(true);
  });
  it("a creature at 0 HP is defeated, a character at 0 HP is dying", () => {
    expect(isDefeated({ hp: 0 })).toBe(true);
    expect(isDefeated({ hp: -3 })).toBe(true);
    expect(isDefeated({ hp: 0, character: true })).toBe(false);
  });
  it("hit points above 0 or unknown: not defeated", () => {
    expect(isDefeated({ hp: 5 })).toBe(false);
    expect(isDefeated({ hp: null })).toBe(false);
    expect(isDefeated({})).toBe(false);
    expect(isDefeated()).toBe(false);
  });
  it("a combat counts once begun", () => {
    expect(wasPlayed({ started: true, round: 1 })).toBe(true);
    expect(wasPlayed({ started: false, round: 2 })).toBe(true);
    expect(wasPlayed({ started: false, round: 0 })).toBe(false);
    expect(wasPlayed()).toBe(false);
  });
});
