import { describe, it, expect } from "vitest";
import { LIGHT, lightLevel, perceivedLight, obscurement, lightIndicator, globalLightLevel } from "../module/scripts/core/illumination.mjs";

describe("light level at a point", () => {
  it("with nothing: Darkness", () => {
    expect(lightLevel()).toEqual({ level: LIGHT.DARK, darkened: false });
  });
  it("global light gives its level, Bright or Dim", () => {
    expect(lightLevel({ global: LIGHT.BRIGHT }).level).toBe(LIGHT.BRIGHT);
    expect(lightLevel({ global: LIGHT.DIM }).level).toBe(LIGHT.DIM);
  });
  it("a torch: Bright Light within its bright radius, Dim Light beyond; the strongest wins", () => {
    expect(lightLevel({ lights: [{ priority: 0, bright: false }] }).level).toBe(LIGHT.DIM);
    expect(lightLevel({ lights: [{ priority: 0, bright: false }, { priority: 0, bright: true }] }).level).toBe(LIGHT.BRIGHT);
    expect(lightLevel({ global: LIGHT.DIM, lights: [{ priority: 0, bright: true }] }).level).toBe(LIGHT.BRIGHT);
  });
  it("Darkness extinguishes global light and lights of lower or equal priority", () => {
    expect(lightLevel({ global: LIGHT.BRIGHT, darkness: [{ priority: 0 }] })).toEqual({ level: LIGHT.DARK, darkened: true });
    expect(lightLevel({ lights: [{ priority: 0, bright: true }], darkness: [{ priority: 0 }] }).level).toBe(LIGHT.DARK);
    expect(lightLevel({ lights: [{ priority: 1, bright: true }], darkness: [{ priority: 2 }] }).level).toBe(LIGHT.DARK);
  });
  it("a magical light stronger than the Darkness restores the lighting", () => {
    expect(lightLevel({ lights: [{ priority: 3, bright: true }], darkness: [{ priority: 2 }] }))
      .toEqual({ level: LIGHT.BRIGHT, darkened: false });
  });
  it("Darkness with no light to extinguish stays magical Darkness", () => {
    expect(lightLevel({ darkness: [{ priority: 0 }] })).toEqual({ level: LIGHT.DARK, darkened: true });
  });
});

describe("level perceived according to the senses", () => {
  const dark = { level: LIGHT.DARK, darkened: false };
  const magical = { level: LIGHT.DARK, darkened: true };
  const dim = { level: LIGHT.DIM };
  const bright = { level: LIGHT.BRIGHT };

  it("with no particular sense, the actual level", () => {
    expect(perceivedLight(dark)).toBe(LIGHT.DARK);
    expect(perceivedLight(dim)).toBe(LIGHT.DIM);
    expect(perceivedLight(bright)).toBe(LIGHT.BRIGHT);
  });
  it("Darkvision: Dim Light → Bright Light, Darkness → Dim Light (hence the Disadvantage on Perception in the dark)", () => {
    expect(perceivedLight(dim, { darkvision: true })).toBe(LIGHT.BRIGHT);
    expect(perceivedLight(dark, { darkvision: true })).toBe(LIGHT.DIM);
    expect(obscurement(perceivedLight(dark, { darkvision: true })).perceptionDisadvantage).toBe(true);
  });
  it("Darkvision does not pierce magical Darkness", () => {
    expect(perceivedLight(magical, { darkvision: true })).toBe(LIGHT.DARK);
  });
  it("Devil's Sight: sees normally in Dim Light and in Darkness, magical or not", () => {
    expect(perceivedLight(dim, { devilsSight: true })).toBe(LIGHT.BRIGHT);
    expect(perceivedLight(magical, { devilsSight: true })).toBe(LIGHT.BRIGHT);
  });
  it("Truesight: pierces Darkness, not Dim Light", () => {
    expect(perceivedLight(magical, { truesight: true })).toBe(LIGHT.BRIGHT);
    expect(perceivedLight(dim, { truesight: true })).toBe(LIGHT.DIM);
  });
  it("out of range, a sense does not count (the adapter passes false)", () => {
    expect(perceivedLight(dark, { darkvision: false })).toBe(LIGHT.DARK);
  });
});

describe("obscurcissement", () => {
  it("bright: nothing; dim: lightly obscured; Darkness: heavily obscured", () => {
    expect(obscurement(LIGHT.BRIGHT)).toEqual({ obscured: "none", perceptionDisadvantage: false, blinded: false });
    expect(obscurement(LIGHT.DIM)).toEqual({ obscured: "light", perceptionDisadvantage: true, blinded: false });
    expect(obscurement(LIGHT.DARK)).toEqual({ obscured: "heavy", perceptionDisadvantage: false, blinded: true });
  });
});

describe("light indicator", () => {
  it("the actual level, and magical Darkness set apart", () => {
    expect(lightIndicator({ level: LIGHT.BRIGHT }, LIGHT.BRIGHT)).toEqual({ key: "bright", own: null });
    expect(lightIndicator({ level: LIGHT.DIM }, LIGHT.DIM)).toEqual({ key: "dim", own: null });
    expect(lightIndicator({ level: LIGHT.DARK, darkened: true }, LIGHT.DARK)).toEqual({ key: "magical", own: null });
  });
  it("what the token itself perceives, if it perceives differently (Darkvision)", () => {
    expect(lightIndicator({ level: LIGHT.DARK }, LIGHT.DIM)).toEqual({ key: "dark", own: "dim" });
    expect(lightIndicator({ level: LIGHT.DIM }, LIGHT.BRIGHT)).toEqual({ key: "dim", own: "bright" });
  });
});

describe("global light and twilight", () => {
  const vive = { active: true, bright: 5000, darkness: { min: 0, max: 0.75 } };
  it("like the core: bright within its range, nothing outside its range or when off, dim if not bright", () => {
    expect(globalLightLevel(vive, 0.3)).toBe(LIGHT.BRIGHT);
    expect(globalLightLevel(vive, 0.8)).toBeNull();
    expect(globalLightLevel({ ...vive, active: false }, 0.3)).toBeNull();
    expect(globalLightLevel({ ...vive, bright: 0 }, 0.3)).toBe(LIGHT.DIM);
  });
  it("twilight: dim as soon as the darkness reaches the threshold, as long as it stays within the range", () => {
    expect(globalLightLevel(vive, 0.59, 0.6)).toBe(LIGHT.BRIGHT);
    expect(globalLightLevel(vive, 0.6, 0.6)).toBe(LIGHT.DIM);
    expect(globalLightLevel(vive, 0.75, 0.6)).toBe(LIGHT.DIM);
    expect(globalLightLevel(vive, 0.76, 0.6)).toBeNull();
  });
  it("threshold at 1: no twilight", () => {
    expect(globalLightLevel(vive, 0.75, 1)).toBe(LIGHT.BRIGHT);
  });
});
