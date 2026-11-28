import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { rectOfShape, pointInRect, contiguousRects, anyShapeTakes } from "../module/scripts/core/space.mjs";

const cube = (x, y, side=100) => ({ x0: x, y0: y, x1: x + side, y1: y + side });

describe("§286 : zones de plusieurs formes", () => {
  it("rectangle of a region shape, anchor included; not for a circle", () => {
    expect(rectOfShape({ type: "rectangle", x: 100, y: 200, width: 50, height: 60 })).toEqual({ x0: 100, y0: 200, x1: 150, y1: 260 });
    expect(rectOfShape({ type: "rectangle", x: 100, y: 200, width: 50, height: 60, anchorX: 0.5, anchorY: 0.5 })).toEqual({ x0: 75, y0: 170, x1: 125, y1: 230 });
    expect(rectOfShape({ type: "circle", x: 0, y: 0, radius: 5 })).toBeNull();
    expect(pointInRect({ x: 150, y: 260 }, cube(50, 160))).toBe(true);
    expect(pointInRect({ x: 151, y: 100 }, cube(50, 0))).toBe(false);
  });

  it("Fire Storm: Cubes joined by a face are contiguous, a lone corner is not enough", () => {
    expect(contiguousRects([cube(0, 0)])).toBe(true);
    expect(contiguousRects([cube(0, 0), cube(100, 0), cube(200, 0), cube(200, 100)])).toBe(true);
    expect(contiguousRects([cube(0, 0), cube(50, 50)])).toBe(true);   // chevauchement
    expect(contiguousRects([cube(0, 0), cube(100, 100)])).toBe(false);   // coin seul
    expect(contiguousRects([cube(0, 0), cube(100, 0), cube(400, 0)])).toBe(false);   // an isolated Cube
  });

  it("a creature is caught if a shape contains it and reaches it — only once", () => {
    expect(anyShapeTakes([])).toEqual({ inVolume: null, lineOfEffect: null });
    // In the second Sphere only.
    expect(anyShapeTakes([{ inShape: false, lineOfEffect: true }, { inShape: true, lineOfEffect: true }])).toEqual({ inVolume: true, lineOfEffect: true });
    // In two Spheres: caught (once).
    expect(anyShapeTakes([{ inShape: true, lineOfEffect: true }, { inShape: true, lineOfEffect: true }])).toEqual({ inVolume: true, lineOfEffect: true });
    // In a Sphere whose origin is behind a floor, and the other reaches it but does not contain it: spared.
    expect(anyShapeTakes([{ inShape: true, lineOfEffect: false }, { inShape: false, lineOfEffect: true }])).toEqual({ inVolume: null, lineOfEffect: false });
    // Outside every Sphere.
    expect(anyShapeTakes([{ inShape: false, lineOfEffect: true }, { inShape: false, lineOfEffect: null }])).toEqual({ inVolume: false, lineOfEffect: null });
    // Cubes : appartenance inconnue (null) — l'origine qui l'atteint suffit.
    expect(anyShapeTakes([{ inShape: null, lineOfEffect: null }])).toEqual({ inVolume: null, lineOfEffect: null });
  });
});

describe("§286: Chain Lightning", () => {
  it("secondary targets 9 m from the first", () => {
    expect(CONTENT["chain-lightning"].chain).toEqual({ radius: 30, units: "ft" });
  });

  it("schema of `chain`", () => {
    expect(validateEntry({ chain: { radius: 30, units: "ft" } }, { at: "x." })).toEqual([]);
    expect(validateEntry({ chain: { radius: 0, units: "ft" } }, { at: "x." }).length).toBe(1);
    expect(validateEntry({ chain: { radius: 30 } }, { at: "x." }).length).toBe(1);
    expect(validateEntry({ chain: { radius: 30, units: "ft", max: 3 } }, { at: "x." }).length).toBe(1);
  });

  it("Conjure Volley and Destructive Wave: the caster's allies spared (§263)", () => {
    expect(CONTENT["conjure-volley"].zoneAffects).toBe("enemy");
    expect(CONTENT["destructive-wave"].zoneAffects).toBe("enemy");
  });
});
