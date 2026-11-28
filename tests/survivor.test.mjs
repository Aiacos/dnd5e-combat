/**
 * Survivor (Fighter, Champion 18 — SRD 5.2). Defy Death: a 18 to 20 on a Death Saving Throw counts as a 20. Heroic Rally:
 * at the start of each of its turns, the Bloodied Champion with at least 1 Hit Point regains Hit Points.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { turnStartHealDue, deathSaveCriticalOf } from "../module/scripts/core/self-care.mjs";

describe("Heroic Rally — turnStartHealDue", () => {
  const rule = { activity: "5Fo0QwzexIPyLP3W", bloodied: true };
  it("Bloodied (half HP or less) and at least 1 HP", () => {
    expect(turnStartHealDue(rule, { hp: 30, max: 60 })).toBe(true);
    expect(turnStartHealDue(rule, { hp: 1, max: 60 })).toBe(true);
    expect(turnStartHealDue(rule, { hp: 31, max: 60 })).toBe(false);
    expect(turnStartHealDue(rule, { hp: 0, max: 60 })).toBe(false);
    expect(turnStartHealDue(rule, { hp: 30, max: 61 })).toBe(true);
  });
  it("without `bloodied`: as soon as HP are missing; never at full HP nor without a rule", () => {
    expect(turnStartHealDue({ activity: "5Fo0QwzexIPyLP3W" }, { hp: 59, max: 60 })).toBe(true);
    expect(turnStartHealDue({ activity: "5Fo0QwzexIPyLP3W" }, { hp: 60, max: 60 })).toBe(false);
    expect(turnStartHealDue(undefined, { hp: 10, max: 60 })).toBe(false);
  });
});

describe("Defy Death — deathSaveCriticalOf", () => {
  it("the lowest of the declared thresholds, or nothing", () => {
    expect(deathSaveCriticalOf([undefined, 18, null])).toBe(18);
    expect(deathSaveCriticalOf([19, 18])).toBe(18);
    expect(deathSaveCriticalOf([undefined])).toBe(null);
    expect(deathSaveCriticalOf([20, 1, 18.5])).toBe(null);
  });
});

describe("the entry and the schema", () => {
  it("Survivant", () => {
    expect(CONTENT["survivor"]).toEqual({ deathSaveCritical: 18, turnStartHeal: { activity: "5Fo0QwzexIPyLP3W", bloodied: true } });
    expect(validateEntry(CONTENT["survivor"])).toEqual([]);
  });
  it("rejected forms", () => {
    expect(validateEntry({ turnStartHeal: { activity: "court" } }).length).toBe(1);
    expect(validateEntry({ turnStartHeal: { activity: "5Fo0QwzexIPyLP3W", bloodied: false } }).length).toBe(1);
    expect(validateEntry({ deathSaveCritical: 20 }).length).toBe(1);
    expect(validateEntry({ deathSaveCritical: 18 })).toEqual([]);
  });
});
