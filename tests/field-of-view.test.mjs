/**
 * A sense's field of view (core/light.mjs `fieldOfView`): the map is seen up to the range of Truesight, Blindsight or Devil's
 * Sight, when that sense reaches at least as far as the Darkvision projected by dnd5e.
 */
import { describe, it, expect } from "vitest";
import { fieldOfView, FIELD_MODES } from "../module/scripts/core/light.mjs";

describe("fieldOfView — quel sens fait le champ de vue", () => {
  it("none of these senses: nothing to change", () => {
    expect(fieldOfView({})).toBe(null);
    expect(fieldOfView({ darkvision: 60 })).toBe(null);
    expect(fieldOfView()).toBe(null);
  });
  it("Blindsight alone: its field, without color, at its range", () => {
    expect(fieldOfView({ blindsight: 30 })).toMatchObject({ sense: "blindsight", range: 30, visionMode: "dasBlindsight",
      saturation: -1 });
  });
  it("Truesight: in color; dnd5e projected it as a Darkvision of the same range", () => {
    expect(fieldOfView({ darkvision: 30, seeAll: 30 })).toMatchObject({ sense: "seeAll", range: 30, visionMode: "dasTruesight",
      saturation: 0, brightness: 1 });
  });
  it("Devil's Sight: in color, at 120 ft, ahead of a shorter Darkvision", () => {
    expect(fieldOfView({ darkvision: 60, devilsSight: 120 })).toMatchObject({ sense: "devilsSight", range: 120,
      visionMode: "dasDevilsSight" });
  });
  it("Darkvision reaches farther: it is the one, nothing is changed", () => {
    expect(fieldOfView({ darkvision: 120, blindsight: 10 })).toBe(null);
    expect(fieldOfView({ darkvision: 120, seeAll: 30 })).toBe(null);
  });
  it("several senses: the greatest range; on a tie, Truesight, then Blindsight, then Devil's Sight", () => {
    expect(fieldOfView({ seeAll: 30, blindsight: 60 }).sense).toBe("blindsight");
    expect(fieldOfView({ seeAll: 60, blindsight: 60, devilsSight: 60 }).sense).toBe("seeAll");
    expect(fieldOfView({ blindsight: 120, devilsSight: 120 }).sense).toBe("blindsight");
  });
  it("an unlimited range stays unlimited (the adapter bounds it to the scene)", () => {
    expect(fieldOfView({ seeAll: Infinity }).range).toBe(Infinity);
  });
  it("each mode has its id, its label and its image", () => {
    for ( const mode of Object.values(FIELD_MODES) ) {
      expect(mode.id).toMatch(/^das[A-Z]/);
      expect(typeof mode.label).toBe("string");
      for ( const key of ["contrast", "saturation", "brightness"] ) {
        expect(Number.isFinite(mode[key]), `${mode.id}.${key}`).toBe(true);
      }
    }
  });
});
