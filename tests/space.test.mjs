import { describe, it, expect } from "vitest";
import { depthOf, verticalExtent, verticalGap, regionElevationFor, originPointOfShapes, withinSphere, pointBoxDistance } from "../module/scripts/core/space.mjs";

describe("depthOf — height of a creature in cells", () => {
  it("a Medium (1×1) is one cell high", () => {
    expect(depthOf({ width: 1, height: 1, depth: 1 })).toBe(1);
  });
  it("a Large (2×2) or a Huge (3×3) whose depth stayed at 1 is as tall as wide", () => {
    expect(depthOf({ width: 2, height: 2, depth: 1 })).toBe(2);
    expect(depthOf({ width: 3, height: 3, depth: 1 })).toBe(3);
  });
  it("a depth set by hand (≠ 1) wins, even on a Large", () => {
    expect(depthOf({ width: 2, height: 2, depth: 0.5 })).toBe(0.5);
    expect(depthOf({ width: 1, height: 1, depth: 4 })).toBe(4);
    expect(depthOf({ width: 2, height: 2, depth: 0 })).toBe(0);
  });
  it("a Tiny (0.5) keeps one cell of height", () => {
    expect(depthOf({ width: 0.5, height: 0.5, depth: 1 })).toBe(1);
  });
  it("without data, one cell", () => {
    expect(depthOf()).toBe(1);
  });
});

describe("verticalExtent / verticalGap", () => {
  it("a token goes from its feet to its head", () => {
    expect(verticalExtent({ elevation: 10, depth: 2 }, 5)).toEqual({ bottom: 10, top: 20 });
    expect(verticalExtent({ elevation: 0, depth: 1 }, 5)).toEqual({ bottom: 0, top: 5 });
  });
  it("the gap is zero when the slices overlap or touch", () => {
    expect(verticalGap({ bottom: 0, top: 5 }, { bottom: 5, top: 10 })).toBe(0);
    expect(verticalGap({ bottom: 0, top: 10 }, { bottom: 5, top: 15 })).toBe(0);
    expect(verticalGap({ bottom: 5, top: 10 }, { bottom: 0, top: 20 })).toBe(0);
  });
  it("otherwise it is the distance between the head of one and the feet of the other, in both directions", () => {
    expect(verticalGap({ bottom: 0, top: 5 }, { bottom: 10, top: 15 })).toBe(5);
    expect(verticalGap({ bottom: 10, top: 15 }, { bottom: 0, top: 5 })).toBe(5);
    expect(verticalGap({ bottom: 0, top: 5 }, { bottom: 60, top: 65 })).toBe(55);
  });
});

describe("regionElevationFor — elevation slice of an area", () => {
  const ground = { elevation: 0, depth: 1 };
  const flying = { elevation: 30, depth: 1 };
  const huge = { elevation: 0, depth: 3 };
  it("a Sphere is centered on the origin elevation (Fireball, 20 ft)", () => {
    expect(regionElevationFor({ type: "sphere", size: 20 }, ground, 5)).toEqual({ bottom: -20, top: 20 });
    expect(regionElevationFor({ type: "sphere", size: 20 }, flying, 5)).toEqual({ bottom: 10, top: 50 });
  });
  it("an Emanation surrounds the caster's body (Spirit Guardians, 15 ft, Huge caster)", () => {
    expect(regionElevationFor({ type: "radius", size: 15 }, huge, 5)).toEqual({ bottom: -15, top: 30 });
    expect(regionElevationFor({ type: "radius", size: 10 }, ground, 5)).toEqual({ bottom: -10, top: 15 });
  });
  it("a Cube is set down and as tall as wide", () => {
    expect(regionElevationFor({ type: "cube", size: 15 }, ground, 5)).toEqual({ bottom: 0, top: 15 });
    expect(regionElevationFor({ type: "square", size: 10 }, flying, 5)).toEqual({ bottom: 30, top: 40 });
  });
  it("a cylinder is set down, with its declared height (Moonbeam: 5 ft radius, 40 ft high)", () => {
    expect(regionElevationFor({ type: "cylinder", size: 5, height: 40 }, ground, 5)).toEqual({ bottom: 0, top: 40 });
  });
  it("a cylinder without height is as tall as its diameter", () => {
    expect(regionElevationFor({ type: "cylinder", size: 10 }, ground, 5)).toEqual({ bottom: 0, top: 20 });
  });
  it("a Cone has half its length above and below (Burning Hands, 15 ft)", () => {
    expect(regionElevationFor({ type: "cone", size: 15 }, ground, 5)).toEqual({ bottom: -7.5, top: 7.5 });
  });
  it("a Line has the caster's thickness or its width, whichever is greater (Lightning Bolt, 100 × 5 ft)", () => {
    expect(regionElevationFor({ type: "line", size: 100, width: 5 }, ground, 5)).toEqual({ bottom: 0, top: 5 });
    expect(regionElevationFor({ type: "line", size: 100, width: 5 }, huge, 5)).toEqual({ bottom: 0, top: 15 });
    expect(regionElevationFor({ type: "line", size: 60, width: 10 }, ground, 5)).toEqual({ bottom: 0, top: 10 });
  });
  it("a wall is set down, with its height; a ring with its height or like a Sphere", () => {
    expect(regionElevationFor({ type: "wall", size: 60, width: 1, height: 20 }, ground, 5)).toEqual({ bottom: 0, top: 20 });
    expect(regionElevationFor({ type: "wall", size: 60, width: 10 }, ground, 5)).toEqual({ bottom: 0, top: 10 });
    expect(regionElevationFor({ type: "ring", size: 20, height: 10 }, ground, 5)).toEqual({ bottom: 0, top: 10 });
    expect(regionElevationFor({ type: "ring", size: 20 }, ground, 5)).toEqual({ bottom: -20, top: 20 });
  });
  it("unknown shape or without size: null, nothing is touched", () => {
    expect(regionElevationFor({ type: "sphere" }, ground, 5)).toBe(null);
    expect(regionElevationFor({ type: "sphere", size: 0 }, ground, 5)).toBe(null);
    expect(regionElevationFor({ type: "blob", size: 10 }, ground, 5)).toBe(null);
    expect(regionElevationFor({ type: "" , size: 10 }, ground, 5)).toBe(null);
  });
  it("without a known caster, the origin is on the ground", () => {
    expect(regionElevationFor({ type: "cube", size: 10 }, undefined, 5)).toEqual({ bottom: 0, top: 10 });
  });
});

describe("originPointOfShapes — point d'origine d'une zone", () => {
  const fallback = { x: 1, y: 2 };
  it("center of a circle or an ellipse, origin of a Cone, a Line, a ring", () => {
    expect(originPointOfShapes([{ type: "circle", x: 100, y: 200, radius: 50 }])).toEqual({ x: 100, y: 200 });
    expect(originPointOfShapes([{ type: "ellipse", x: 10, y: 20, radiusX: 5, radiusY: 3 }])).toEqual({ x: 10, y: 20 });
    expect(originPointOfShapes([{ type: "cone", x: 10, y: 20, radius: 300, angle: 53 }])).toEqual({ x: 10, y: 20 });
    expect(originPointOfShapes([{ type: "line", x: 10, y: 20, length: 300, width: 100 }])).toEqual({ x: 10, y: 20 });
    expect(originPointOfShapes([{ type: "ring", x: 10, y: 20, radius: 300 }])).toEqual({ x: 10, y: 20 });
  });
  it("centre d'un rectangle, ancre comprise", () => {
    expect(originPointOfShapes([{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }])).toEqual({ x: 50, y: 25 });
    expect(originPointOfShapes([{ type: "rectangle", x: 50, y: 25, width: 100, height: 50, anchorX: 0.5, anchorY: 0.5 }])).toEqual({ x: 50, y: 25 });
  });
  it("origine ou centre de masse d'un polygone", () => {
    expect(originPointOfShapes([{ type: "polygon", points: [0, 0, 100, 0, 100, 100, 0, 100], origin: { x: 5, y: 6 } }])).toEqual({ x: 5, y: 6 });
    expect(originPointOfShapes([{ type: "polygon", points: [0, 0, 100, 0, 100, 100, 0, 100] }])).toEqual({ x: 50, y: 50 });
    expect(originPointOfShapes([{ type: "polygon", points: [] }], fallback)).toBe(fallback);
  });
  it("Emanation, token shape, unknown shape, no shape: the fallback", () => {
    expect(originPointOfShapes([{ type: "emanation", base: { type: "token" }, radius: 100 }], fallback)).toBe(fallback);
    expect(originPointOfShapes([{ type: "token", x: 0, y: 0, width: 1, height: 1 }], fallback)).toBe(fallback);
    expect(originPointOfShapes([], fallback)).toBe(fallback);
    expect(originPointOfShapes(undefined, null)).toBe(null);
  });
  it("14.370: \"grid cells\" shape — its origin, otherwise the fallback", () => {
    expect(originPointOfShapes([{ type: "grid", offsets: [{ i: 1, j: 2 }], origin: { x: 70, y: 80 } }], fallback)).toEqual({ x: 70, y: 80 });
    expect(originPointOfShapes([{ type: "grid", offsets: [{ i: 1, j: 2 }], origin: null }], fallback)).toBe(fallback);
  });
  it("14.370: a \"hole\" shape is never the origin (careful Fireball)", () => {
    const hole = { type: "grid", hole: true, offsets: [{ i: 3, j: 3 }], origin: { x: 1, y: 1 } };
    expect(originPointOfShapes([hole, { type: "circle", x: 100, y: 200, radius: 50 }])).toEqual({ x: 100, y: 200 });
    expect(originPointOfShapes([{ type: "circle", x: 100, y: 200, radius: 50 }, hole])).toEqual({ x: 100, y: 200 });
    expect(originPointOfShapes([hole], fallback)).toBe(fallback);
  });
});

describe("withinSphere — a true Sphere, not a cylinder (P2)", () => {
  // Units: pixels everywhere, 100 px cell = 5 ft. Fireball of 20 ft radius = 400 px, centered on the ground (z = 0).
  const fireball = { x: 0, y: 0, z: 0, radius: 400 };
  const body = (x, y, z) => ({ x0: x, x1: x + 100, y0: y, y1: y + 100, z0: z, z1: z + 100 });
  it("a creature at the horizontal edge, on the ground, is inside", () => {
    expect(withinSphere(fireball, body(300, 0, 0))).toBe(true);
  });
  it("at the horizontal edge but 15 ft in the air (corner of the cylinder), it is outside the Sphere", () => {
    expect(withinSphere(fireball, body(300, 0, 300))).toBe(false);
  });
  it("just above the center, at 15 ft, it is inside", () => {
    expect(withinSphere(fireball, body(-50, -50, 300))).toBe(true);
  });
  it("the distance to a box is zero when the point is inside", () => {
    expect(pointBoxDistance({ x: 10, y: 10, z: 10 }, body(0, 0, 0))).toBe(0);
    expect(pointBoxDistance({ x: 200, y: 50, z: 50 }, body(0, 0, 0))).toBe(100);
  });
});
