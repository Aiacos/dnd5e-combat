import { describe, it, expect } from "vitest";
import { burnSeconds, lightPlan, burnoutPlan, burnParts, handsOf } from "../module/scripts/core/light.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { GEAR } from "../module/scripts/content/gear.mjs";

describe("§121: duration and fuel of carried sources", () => {
  it("converts the duration", () => {
    expect(burnSeconds({ value: 1, units: "hour" })).toBe(3600);
    expect(burnSeconds({ value: 6, units: "hour" })).toBe(21600);
    expect(burnSeconds(undefined)).toBeNull();
  });
  it("torch: new, started, consumed", () => {
    expect(lightPlan({ stored: undefined, full: 3600 })).toEqual({ ok: true, left: 3600, refill: false });
    expect(lightPlan({ stored: 1200, full: 3600 })).toEqual({ ok: true, left: 1200, refill: false });
    expect(lightPlan({ stored: 0, full: 3600 })).toEqual({ ok: true, left: 3600, refill: false });
  });
  it("lamp: filled, started, empty with or without a flask", () => {
    expect(lightPlan({ stored: undefined, full: 21600, fuel: true })).toEqual({ ok: true, left: 21600, refill: false });
    expect(lightPlan({ stored: 600, full: 21600, fuel: true })).toEqual({ ok: true, left: 600, refill: false });
    expect(lightPlan({ stored: 0, full: 21600, fuel: true, hasFuel: true })).toEqual({ ok: true, left: 21600, refill: true });
    expect(lightPlan({ stored: 0, full: 21600, fuel: true, hasFuel: false })).toEqual({ ok: false, reason: "noFuel" });
  });
  it("without a duration: nothing to count", () => {
    expect(lightPlan({ stored: undefined, full: null })).toEqual({ ok: true, left: null, refill: false });
  });
  it("consumed: the torch goes, the lamp empties", () => {
    expect(burnoutPlan({ fuel: false })).toEqual({ consume: true, stored: undefined });
    expect(burnoutPlan({ fuel: true })).toEqual({ consume: false, stored: 0 });
  });
  it("affiche heures et minutes", () => {
    expect(burnParts(3600)).toEqual({ h: 1, m: 0 });
    expect(burnParts(3599)).toEqual({ h: 1, m: 0 });
    expect(burnParts(19200)).toEqual({ h: 5, m: 20 });
    expect(burnParts(30)).toEqual({ h: 0, m: 1 });
  });
  it("counts the hands that are occupied", () => {
    expect(handsOf([])).toEqual({ used: 0, free: 2 });
    expect(handsOf([{ name: "Épée longue", hands: 1 }])).toEqual({ used: 1, free: 1 });
    expect(handsOf([{ name: "Épée longue", hands: 1 }, { name: "Bouclier", hands: 1 }])).toEqual({ used: 2, free: 0 });
    expect(handsOf([{ name: "Épée à deux mains", hands: 2 }])).toEqual({ used: 2, free: 0 });
    expect(handsOf([{ name: "Dague", hands: 1 }, { name: "Dague", hands: 1 }, { name: "Arc", hands: 2 }])).toEqual({ used: 4, free: 0 });
  });
  it("the shipped content is valid (duration, fuel)", () => {
    for ( const id of ["torch", "candle", "lamp", "lantern-hooded", "lantern-bullseye", "bullseye-lantern"] ) {
      expect(validateEntry(GEAR[id]), id).toEqual([]);
      expect(burnSeconds(GEAR[id].carriedLight.burn), id).toBeGreaterThan(0);
    }
    for ( const id of ["lamp", "lantern-hooded", "lantern-bullseye", "bullseye-lantern"] ) expect(GEAR[id].carriedLight.fuel, id).toBe("oil");
    expect(validateEntry({ carriedLight: { bright: 5, dim: 10, units: "ft", burn: { value: 1, units: "day" } } }).length).toBe(1);
    expect(validateEntry({ carriedLight: { bright: 5, dim: 10, units: "ft", fuel: "" } }).length).toBeGreaterThan(0);
  });
});
