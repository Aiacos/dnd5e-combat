/** §62 : l'ouïe — on sait où est une créature qu'on ne voit pas, sauf si elle est cachée. */
import { describe, it, expect } from "vitest";
import { hears, locationUnknown, hearingRange, beyondHearing } from "../module/scripts/core/hearing.mjs";

describe("hears", () => {
  it("par défaut, on entend", () => {
    expect(hears({})).toBe(true);
  });
  it("assourdi, cible cachée, cible morte ou mur qui arrête le son : on n'entend pas", () => {
    expect(hears({ deafened: true })).toBe(false);
    expect(hears({ hidden: true })).toBe(false);
    expect(hears({ silent: true })).toBe(false);
    expect(hears({ soundBlocked: true })).toBe(false);
  });
});

describe("portée d'ouïe (réglage `hearingRange`, règle maison)", () => {
  it("sans réglage, ou une formule qui ne donne pas un nombre : pas de portée", () => {
    for ( const value of [null, undefined, NaN, Infinity, -5, "30", {}] ) expect(hearingRange(value), String(value)).toBe(null);
    expect(hearingRange(30)).toBe(30);
    expect(hearingRange(0)).toBe(0);
  });
  it("sans portée, rien n'est trop loin ; avec, la limite est comprise", () => {
    expect(beyondHearing(1000, null)).toBe(false);
    expect(beyondHearing(1000, undefined)).toBe(false);
    expect(beyondHearing(30, 30)).toBe(false);
    expect(beyondHearing(35, 30)).toBe(true);
    expect(beyondHearing(5, 0)).toBe(true);
  });
  it("au-delà de la portée, on n'entend pas", () => {
    expect(hears({ outOfRange: true })).toBe(false);
    expect(hears({ outOfRange: false })).toBe(true);
  });
});

describe("locationUnknown", () => {
  it("cachée et non vue : position inconnue", () => {
    expect(locationUnknown({ hidden: true, sees: false })).toBe(true);
  });
  it("cachée mais perçue (vision aveugle…) : on sait où elle est", () => {
    expect(locationUnknown({ hidden: true, sees: true })).toBe(false);
  });
  it("invisible sans être cachée : on l'entend, on sait où elle est", () => {
    expect(locationUnknown({ hidden: false, sees: false })).toBe(false);
  });
  it("la vision ne peut pas trancher : on laisse faire", () => {
    expect(locationUnknown({ hidden: true, sees: null })).toBe(false);
  });
});
