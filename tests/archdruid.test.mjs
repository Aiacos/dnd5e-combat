/**
 * Archidruide (Druide 20, SRD 5.2), Forme sauvage persistante : « quand vous jouez l'initiative et n'avez plus d'utilisation de
 * Forme sauvage, vous en regagnez une ». Vu en jeu : rien ne revenait, l'activité de l'item était à utiliser à la main.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { initiativeRegain } from "../module/scripts/core/self-care.mjs";

describe("Archidruide — Forme sauvage persistante", () => {
  const rule = CONTENT["archdruid"].regainOnInitiative;
  it("l'entrée : la Forme sauvage remonte à une utilisation", () => {
    expect(rule).toEqual({ item: "wild-shape", upTo: 1 });
    expect(validateEntry(CONTENT["archdruid"])).toEqual([]);
  });
  it("sans utilisation restante, une revient ; avec une ou plus, rien", () => {
    expect(initiativeRegain(rule, { items: { "wild-shape": { max: 4, spent: 4 } } })).toEqual({ spent: { "wild-shape": 3 }, exhaustion: null, pay: false });
    expect(initiativeRegain(rule, { items: { "wild-shape": { max: 4, spent: 3 } } })).toBe(null);
    expect(initiativeRegain(rule, { items: { "wild-shape": { max: 4, spent: 0 } } })).toBe(null);
  });
});
