import { describe, it, expect } from "vitest";
import { polylineLength, clampPolyline, wallLineShapes, lineAxis, polygonEdges, orthogonalize, sideOfSegment, wallGeometry, defaultSide, sideShapes, ringShapes, crossesWall, touchesWall, wallLightPoints, cellWallShapes, innerRingShapes, auraShapes } from "../module/scripts/core/wall.mjs";

describe("§162: wall placed by points", () => {
  it("the broken line brought back to the spell's length", () => {
    const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }];
    expect(polylineLength(pts)).toBe(700);
    expect(clampPolyline(pts, 500)).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }]);
    expect(clampPolyline(pts, 300)).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    expect(clampPolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });
  it("a segment, a \"line\" shape; its axis comes back from it", () => {
    const [a, b] = wallLineShapes([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 14);
    expect(a).toEqual({ type: "line", x: 0, y: 0, rotation: 0, length: 100, width: 14 });
    expect(b.rotation).toBe(90);
    expect(lineAxis(b)).toEqual([100, 0, 100, 100]);
  });
  it("the edges of a closed polygon", () => {
    expect(polygonEdges([0, 0, 10, 0, 10, 10])).toEqual([[0, 0, 10, 0], [10, 0, 10, 10], [10, 10, 0, 0]]);
  });
});

describe("§169: wall with a burning face", () => {
  it("no diagonal: each point aligned with the previous one", () => {
    expect(orthogonalize([{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 260, y: 500 }])).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 500 }]);
  });
  it("the geometry: segments, or ring (disk placed, then thin ring)", () => {
    const line = { type: "line", x: 0, y: 0, rotation: 0, length: 200, width: 20 };
    expect(wallGeometry([line])).toEqual({ lines: [[0, 0, 200, 0]] });
    expect(wallGeometry([{ type: "circle", x: 50, y: 50, radius: 200 }])).toEqual({ ring: { x: 50, y: 50, radius: 200 } });
    expect(wallGeometry(ringShapes({ x: 50, y: 50, radius: 200 }, 20))).toEqual({ ring: { x: 50, y: 50, radius: 200 } });
    expect(wallGeometry([{ type: "ring", x: 50, y: 50, radius: 200, innerWidth: 0, outerWidth: 28 }])).toEqual({ ring: { x: 50, y: 50, radius: 214 } });
    expect(wallGeometry([{ type: "ellipse", x: 50, y: 50, radiusX: 200, radiusY: 200 }])).toEqual({ ring: { x: 50, y: 50, radius: 200 } });
  });
  it("the default burning side: opposite the caster", () => {
    const g = { lines: [[0, 0, 200, 0]] };
    expect(sideOfSegment(g.lines[0], { x: 100, y: -50 })).toBe(1);   // north of a path going east: on the left
    expect(defaultSide(g, { x: 100, y: -50 })).toBe(-1);
    expect(defaultSide(g, { x: 100, y: 50 })).toBe(1);
    const ring = { ring: { x: 0, y: 0, radius: 200 } };
    expect(defaultSide(ring, { x: 10, y: 0 })).toBe(-1);   // inside: the outside burns
    expect(defaultSide(ring, { x: 500, y: 0 })).toBe(1);
  });
  it("the forms of the burning face", () => {
    const [north] = sideShapes({ lines: [[0, 0, 200, 0]] }, 1, 200);
    expect(north).toEqual({ type: "polygon", points: [0, 0, 200, 0, 200, -200, 0, -200] });
    const [south] = sideShapes({ lines: [[0, 0, 200, 0]] }, -1, 200);
    expect(south.points).toEqual([0, 0, 200, 0, 200, 200, 0, 200]);
    expect(sideShapes({ ring: { x: 0, y: 0, radius: 200 } }, -1, 200)).toEqual([{ type: "ring", x: 0, y: 0, radius: 200, innerWidth: 0, outerWidth: 200 }]);
    expect(sideShapes({ ring: { x: 0, y: 0, radius: 200 } }, 1, 200)).toEqual([{ type: "circle", x: 0, y: 0, radius: 200 }]);
  });
  it("crossing the wall: a step from one center to the other that cuts the line, or the circle", () => {
    const g = { lines: [[0, 0, 300, 0]] };
    expect(crossesWall(g, [{ x: 50, y: -50 }, { x: 50, y: 50 }])).toBe(true);
    expect(crossesWall(g, [{ x: 50, y: -50 }, { x: 150, y: -50 }])).toBe(false);
    expect(crossesWall(g, [{ x: 350, y: -50 }, { x: 350, y: 50 }])).toBe(false);   // beyond the end
    const ring = { ring: { x: 0, y: 0, radius: 200 } };
    expect(crossesWall(ring, [{ x: 150, y: 0 }, { x: 250, y: 0 }])).toBe(true);
    expect(crossesWall(ring, [{ x: 50, y: 0 }, { x: 150, y: 0 }])).toBe(false);
  });
  it("on appearing: the spaces that touch the wall, on both sides, not by a corner", () => {
    const g = { lines: [[0, 0, 300, 0]] };
    expect(touchesWall(g, { x: 0, y: -100, width: 100, height: 100 })).toBe(true);    // au nord, le long
    expect(touchesWall(g, { x: 100, y: 0, width: 100, height: 100 })).toBe(true);     // au sud
    expect(touchesWall(g, { x: 0, y: 100, width: 100, height: 100 })).toBe(false);    // une case plus loin
    expect(touchesWall(g, { x: 300, y: 0, width: 100, height: 100 })).toBe(false);    // by the corner of the end
    const ring = { ring: { x: 0, y: 0, radius: 200 } };
    expect(touchesWall(ring, { x: 150, y: -50, width: 100, height: 100 })).toBe(true);
    expect(touchesWall(ring, { x: -50, y: -50, width: 100, height: 100 })).toBe(false);   // au centre
  });
});

describe("§170: a wall's lights", () => {
  it("de part et d'autre de la ligne, bouts compris", () => {
    const pts = wallLightPoints({ lines: [[0, 0, 280, 0]] }, 280, 10);
    expect(pts).toEqual([{ x: 0, y: -10 }, { x: 0, y: 10 }, { x: 280, y: -10 }, { x: 280, y: 10 }]);
  });
  it("autour d'un anneau, dedans et dehors", () => {
    const pts = wallLightPoints({ ring: { x: 0, y: 0, radius: 280 } }, 280, 10);
    expect(pts.length).toBe(14);
    expect(pts.slice(0, 2)).toEqual([{ x: 270, y: 0 }, { x: 290, y: 0 }]);
  });
});

describe("§172: thick wall on the cells", () => {
  it("cell centers, without diagonal, extended by half a cell; the spell's length held, ends included", () => {
    // 100 px cells: from (50, 50) to (350, 60) → a row of 4 cells, 400 px.
    const [s] = cellWallShapes([{ x: 50, y: 50 }, { x: 350, y: 60 }], 1000, 100, 50);
    expect(s).toEqual({ type: "line", x: 0, y: 50, rotation: 0, length: 400, width: 100 });
    // Spell length 300 px: three cells at most.
    expect(cellWallShapes([{ x: 50, y: 50 }, { x: 350, y: 50 }], 300, 100, 50)[0].length).toBe(300);
    // Une seule case.
    expect(cellWallShapes([{ x: 50, y: 50 }], 300, 100, 50)).toEqual([{ type: "line", x: 0, y: 50, rotation: 0, length: 100, width: 100 }]);
  });
  it("the ring: a band inside the circle", () => {
    expect(innerRingShapes({ x: 0, y: 0, radius: 280 }, 140)).toEqual([{ type: "ring", x: 0, y: 0, radius: 280, innerWidth: 140, outerWidth: 0 }]);
    expect(wallGeometry(innerRingShapes({ x: 0, y: 0, radius: 280 }, 140)).ring.radius).toBe(210);
  });
});

describe("§173 : la zone autour d'un mur fin", () => {
  it("a rectangle around the segment, extended at the ends; a band around the ring", () => {
    expect(auraShapes({ lines: [[0, 0, 100, 0]] }, 20)).toEqual([{ type: "polygon", points: [-20, 20, 120, 20, 120, -20, -20, -20] }]);
    expect(auraShapes({ ring: { x: 0, y: 0, radius: 100 } }, 20)).toEqual([{ type: "ring", x: 0, y: 0, radius: 100, innerWidth: 20, outerWidth: 20 }]);
  });
});

describe("§169: the burning face at the corners", () => {
  it("a square joins the two bands at the corner of the path", () => {
    // East then south; side +1: north of the first, east of the second — the outer corner, to the north-east.
    const shapes = sideShapes({ lines: [[0, 0, 200, 0], [200, 0, 200, 200]] }, 1, 100);
    expect(shapes).toHaveLength(3);
    expect(shapes[2]).toEqual({ type: "polygon", points: [200, 0, 200, -100, 300, -100, 300, 0] });
    // Two segments that do not touch: no corner.
    expect(sideShapes({ lines: [[0, 0, 200, 0], [400, 0, 400, 200]] }, 1, 100)).toHaveLength(2);
  });
});
