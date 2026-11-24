import { describe, it, expect } from "vitest";
import { AREA_VISIBILITY_CHOICES, areaVisibilityFor } from "../module/scripts/core/area-visibility.mjs";

// The core's REGION_VISIBILITY (common/constants.mjs:2202).
const V = { LAYER_UNLOCKED: 4, LAYER: 0, GAMEMASTER: 1, OBSERVER: 3, ALWAYS: 2 };

describe("who sees an area placed from an activity (§530)", () => {
  it("offers everyone, GM only, Region layer only", () => {
    expect(AREA_VISIBILITY_CHOICES).toEqual(["all", "gm", "layer"]);
  });
  it("everyone: the area keeps what dnd5e or the engine gave it", () => {
    for ( const v of Object.values(V) ) expect(areaVisibilityFor(v, "all", V)).toBe(v);
  });
  it("GM only: an area visible to everyone or to observers becomes GM only", () => {
    expect(areaVisibilityFor(V.ALWAYS, "gm", V)).toBe(V.GAMEMASTER);
    expect(areaVisibilityFor(V.OBSERVER, "gm", V)).toBe(V.GAMEMASTER);
  });
  it("Region layer only: an area visible to anyone becomes Region layer only", () => {
    expect(areaVisibilityFor(V.ALWAYS, "layer", V)).toBe(V.LAYER);
    expect(areaVisibilityFor(V.GAMEMASTER, "layer", V)).toBe(V.LAYER);
  });
  it("never shows an area more than it was about to be (a storm cloud on the Region layer stays there)", () => {
    expect(areaVisibilityFor(V.LAYER, "gm", V)).toBe(V.LAYER);
    expect(areaVisibilityFor(V.LAYER_UNLOCKED, "layer", V)).toBe(V.LAYER_UNLOCKED);
  });
  it("an unknown choice changes nothing", () => {
    expect(areaVisibilityFor(V.ALWAYS, "nobody", V)).toBe(V.ALWAYS);
  });
});
