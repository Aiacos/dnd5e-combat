/**
 * Archdruid (Druid 20, SRD 5.2), Evergreen Wild Shape: "when you roll Initiative and have no uses of Wild Shape left, you
 * regain one". Seen in play: nothing came back, the item's activity had to be used by hand.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { initiativeRegain } from "../module/scripts/core/self-care.mjs";

describe("Archidruide — Forme sauvage persistante", () => {
  const rule = CONTENT["archdruid"].regainOnInitiative;
  it("the entry: Wild Shape goes back up to one use", () => {
    expect(rule).toEqual({ item: "wild-shape", upTo: 1 });
    expect(validateEntry(CONTENT["archdruid"])).toEqual([]);
  });
  it("with no use left, one comes back; with one or more, nothing", () => {
    expect(initiativeRegain(rule, { items: { "wild-shape": { max: 4, spent: 4 } } })).toEqual({ spent: { "wild-shape": 3 }, exhaustion: null, pay: false });
    expect(initiativeRegain(rule, { items: { "wild-shape": { max: 4, spent: 3 } } })).toBe(null);
    expect(initiativeRegain(rule, { items: { "wild-shape": { max: 4, spent: 0 } } })).toBe(null);
  });
});
