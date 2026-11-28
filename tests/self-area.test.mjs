import { describe, it, expect } from "vitest";
import { selfAreaShape, aimedAreaShape, aimFrom, cubeBeside } from "../module/scripts/core/self-area.mjs";

describe("\"on self\" area placed automatically (§47)", () => {
  it("Emanation with a Self range: attached to the caster (\"Whirling Blades\", Spirit Guardians)", () => {
    expect(selfAreaShape({ rangeUnits: "self", type: "radius", count: "", size: 10 })).toBe("emanation");
  });
  it("Sphere or circle with a Self range: centered on the caster (\"Terrifying Howl\")", () => {
    expect(selfAreaShape({ rangeUnits: "self", type: "sphere", size: 30 })).toBe("circle");
    expect(selfAreaShape({ rangeUnits: "self", type: "circle", size: 30 })).toBe("circle");
  });
  it("a direction or a place to choose: dnd5e placement (breaths, Thunderwave, Wall of Fire)", () => {
    for ( const type of ["cone", "line", "cube", "cylinder", "wall", "square"] ) {
      expect(selfAreaShape({ rangeUnits: "self", type, size: 15 })).toBe(null);
    }
  });
  it("another range, several areas or no size: dnd5e placement", () => {
    expect(selfAreaShape({ rangeUnits: "ft", type: "radius", size: 10 })).toBe(null);
    expect(selfAreaShape({ rangeUnits: "self", type: "radius", count: 2, size: 10 })).toBe(null);
    expect(selfAreaShape({ rangeUnits: "self", type: "radius", size: null })).toBe(null);
  });
});

describe("Cone or Line aimed from the caster (§59)", () => {
  it("Cone or Line with a Self range: aimed around the caster (breaths, Burning Hands, Lightning Bolt)", () => {
    expect(aimedAreaShape({ rangeUnits: "self", type: "cone", size: 15 })).toBe("cone");
    expect(aimedAreaShape({ rangeUnits: "self", type: "line", size: 100 })).toBe("line");
    expect(aimedAreaShape({ rangeUnits: "self", type: "cube", size: 15 })).toBe("cube");
  });
  it("another shape, another range, several areas or no size: dnd5e placement", () => {
    for ( const type of ["radius", "sphere", "cylinder", "wall"] ) expect(aimedAreaShape({ rangeUnits: "self", type, size: 15 })).toBe(null);
    expect(aimedAreaShape({ rangeUnits: "ft", type: "cone", size: 15 })).toBe(null);
    expect(aimedAreaShape({ rangeUnits: "self", type: "cone", count: 2, size: 15 })).toBe(null);
    expect(aimedAreaShape({ rangeUnits: "self", type: "cone", size: 0 })).toBe(null);
  });
  const body = { x: 100, y: 100, width: 100, height: 100 };   // centre (150, 150)
  const near = (got, want) => { for ( const k of Object.keys(want) ) expect(got[k]).toBeCloseTo(want[k], 6); };
  it("the apex is on the edge of the space, on the aimed side — never under the caster", () => {
    near(aimFrom(body, { x: 400, y: 150 }), { x: 200, y: 150, rotation: 0 });
    near(aimFrom(body, { x: 150, y: 400 }), { x: 150, y: 200, rotation: 90 });
    near(aimFrom(body, { x: -50, y: 150 }), { x: 100, y: 150, rotation: 180 });
    near(aimFrom(body, { x: 150, y: 0 }), { x: 150, y: 100, rotation: 270 });
  });
  it("diagonally, the apex is at the corner (the origin point on a grid intersection)", () => {
    near(aimFrom(body, { x: 300, y: 300 }), { x: 200, y: 200, rotation: 45 });
    near(aimFrom(body, { x: 0, y: 0 }), { x: 100, y: 100, rotation: 225 });
  });
  it("un grand lanceur pivote autour de son centre", () => {
    near(aimFrom({ x: 0, y: 0, width: 200, height: 200 }, { x: 100, y: 500 }), { x: 100, y: 200, rotation: 90 });
  });
  it("elliptical space: the apex is on the ellipse", () => {
    const p = aimFrom(body, { x: 300, y: 300 }, { ellipse: true });
    expect(Math.hypot(p.x - 150, p.y - 150)).toBeCloseTo(50, 6);
  });
  it("mouse at the center: the fallback direction (last aim), otherwise to the right", () => {
    near(aimFrom(body, { x: 150, y: 150 }), { x: 200, y: 150, rotation: 0 });
    near(aimFrom(body, { x: 150, y: 150 }, { fallback: { x: 0, y: 1 } }), { x: 150, y: 200, rotation: 90 });
  });
});

describe("Cube adjoining the caster (§59, Thunderwave)", () => {
  // Lanceur Moyen en (100, 100), cases de 100 px ; cube de 15 ft = 300 px.
  const body = { x: 100, y: 100, width: 100, height: 100 };
  const opts = { step: 100 };
  it("on the mouse's side, centered on it when possible", () => {
    expect(cubeBeside(body, { x: 600, y: 150 }, 300, opts)).toEqual({ x: 200, y: 0 });
    expect(cubeBeside(body, { x: -400, y: 150 }, 300, opts)).toEqual({ x: -200, y: 0 });
    expect(cubeBeside(body, { x: 150, y: 600 }, 300, opts)).toEqual({ x: 0, y: 200 });
    expect(cubeBeside(body, { x: 150, y: -400 }, 300, opts)).toEqual({ x: 0, y: -200 });
  });
  it("slides along the side, snapped to the grid, up to the corner — never over the caster", () => {
    expect(cubeBeside(body, { x: 600, y: 260 }, 300, opts)).toEqual({ x: 200, y: 100 });
    expect(cubeBeside(body, { x: 600, y: 900 }, 300, opts)).toEqual({ x: 200, y: 200 });
    expect(cubeBeside(body, { x: 600, y: -700 }, 300, opts)).toEqual({ x: 200, y: -200 });
  });
  it("en diagonale : le cube touche le lanceur par le coin", () => {
    expect(cubeBeside(body, { x: 700, y: 700 }, 300, opts)).toEqual({ x: 200, y: 200 });
    expect(cubeBeside(body, { x: -500, y: -500 }, 300, opts)).toEqual({ x: -200, y: -200 });
  });
  it("no grid: free position along the side", () => {
    expect(cubeBeside(body, { x: 600, y: 170 }, 300)).toEqual({ x: 200, y: 20 });
  });
  it("souris au centre : la direction de repli", () => {
    expect(cubeBeside(body, { x: 150, y: 150 }, 300, { ...opts, fallback: { x: 0, y: 1 } })).toEqual({ x: 0, y: 200 });
  });
});
