/**
 * Issue #92: on open ground, the fixed cost of a path was that of the questions asked for each cell — to dnd5e ("does a token
 * occupy this cell?", a search in the token quadtree) and to the core ("is there a wall between these two cells?", a polygon
 * built per step). Two shortcuts that answer only where the answer is known in advance.
 */
import { describe, it, expect } from "vitest";

globalThis.PIXI ??= { Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } } };
const { occupancyIndex, noEdgeBetween } = await import("../module/scripts/adapter/path-world.mjs");

const SIZE = 100;
const grid = { getOffset: ({ x, y }) => ({ i: Math.floor(y / SIZE), j: Math.floor(x / SIZE) }) };
/** A token of `w` × `h` cells whose rectangle is at (i, j); `cells`: the cells dnd5e counts for it. */
const tokenAt = (i, j, { w=1, h=1, cells=null }={}) => {
  const own = [];
  for ( let di = 0; di < h; di++ ) for ( let dj = 0; dj < w; dj++ ) own.push({ i: i + di, j: j + dj });
  const _source = {};
  return { bounds: { x: j * SIZE, y: i * SIZE, width: w * SIZE, height: h * SIZE }, asked: 0,
    document: { _source, getOccupiedGridSpaceOffsets(source) {
      this.asked = (this.asked ?? 0) + 1;
      expect(source).toBe(_source);
      return cells ?? own;
    } } };
};

describe("occupancyIndex — where dnd5e can find an occupant", () => {
  it("another token's cells, not its neighbors that its rectangle merely touches", () => {
    const self = tokenAt(0, 0);
    const big = tokenAt(4, 4, { w: 2, h: 2 });
    const mayHold = occupancyIndex({ placeables: [self, big] }, self, grid);
    for ( const cell of [{ i: 4, j: 4 }, { i: 4, j: 5 }, { i: 5, j: 4 }, { i: 5, j: 5 }] ) {
      expect(mayHold(cell), JSON.stringify(cell)).toBe(true);
    }
    for ( const cell of [{ i: 3, j: 4 }, { i: 6, j: 5 }, { i: 4, j: 3 }, { i: 5, j: 6 }, { i: 3, j: 3 }, { i: 9, j: 9 }] ) {
      expect(mayHold(cell), JSON.stringify(cell)).toBe(false);
    }
  });

  it("the moving token does not count: its own cell is occupied by no one else", () => {
    const self = tokenAt(2, 2);
    expect(occupancyIndex({ placeables: [self] }, self, grid)({ i: 2, j: 2 })).toBe(false);
  });

  it("a token's cells are computed only when a cell its rectangle touches is requested, and only once", () => {
    const self = tokenAt(0, 0);
    const far = tokenAt(8, 8);
    const mayHold = occupancyIndex({ placeables: [self, far] }, self, grid);
    expect(mayHold({ i: 1, j: 1 })).toBe(false);
    expect(far.document.asked ?? 0).toBe(0);
    expect(mayHold({ i: 8, j: 8 })).toBe(true);
    expect(mayHold({ i: 8, j: 9 })).toBe(false);
    expect(far.document.asked).toBe(1);
  });

  it("a token that cannot be read: the cell its rectangle touches is left to dnd5e", () => {
    const self = tokenAt(0, 0);
    const odd = tokenAt(3, 3);
    odd.document.getOccupiedGridSpaceOffsets = () => { throw new Error("no shape"); };
    const mayHold = occupancyIndex({ placeables: [self, odd] }, self, grid);
    expect(mayHold({ i: 3, j: 3 })).toBe(true);
    expect(mayHold({ i: 4, j: 4 })).toBe(true);    // its rectangle touches it (one pixel margin): unknown
    expect(mayHold({ i: 6, j: 6 })).toBe(false);
  });

  it("an unreadable rectangle: null, everything is asked of dnd5e", () => {
    const self = tokenAt(0, 0);
    expect(occupancyIndex({ placeables: [self, { bounds: null, document: {} }] }, self, grid)).toBeNull();
  });
});

describe("noEdgeBetween — no wall to hit on this step", () => {
  const within = { contains: (x, y) => (x >= 0) && (x < 1000) && (y >= 0) && (y < 1000) };
  const edgesWith = found => ({ asked: [],
    getEdges(rect, options) { this.asked.push({ rect, options }); return new Set(found); } });

  it("no edge in the step's rectangle (two pixel margin, scene borders excluded): nothing to hit", () => {
    const edges = edgesWith([]);
    expect(noEdgeBetween(edges, { x: 150, y: 150 }, { x: 250, y: 250 }, within)).toBe(true);
    expect(edges.asked).toEqual([{ rect: { x: 148, y: 148, width: 104, height: 104 },
      options: { includeInnerBounds: false, includeOuterBounds: false } }]);
  });

  it("an edge in this rectangle: the core's test decides", () => {
    expect(noEdgeBetween(edgesWith([{ id: "wall" }]), { x: 150, y: 150 }, { x: 250, y: 150 }, within)).toBe(false);
  });

  it("a step leaving or entering the scene hits its edges, which the quadtree does not contain: the core test decides", () => {
    const edges = edgesWith([]);
    expect(noEdgeBetween(edges, { x: 950, y: 150 }, { x: 1050, y: 150 }, within)).toBe(false);
    expect(noEdgeBetween(edges, { x: -50, y: 150 }, { x: 50, y: 150 }, within)).toBe(false);
    expect(edges.asked).toEqual([]);
  });

  it("without an edge quadtree, or if it fails: the core's test decides", () => {
    expect(noEdgeBetween(null, { x: 150, y: 150 }, { x: 250, y: 150 }, within)).toBe(false);
    const failing = { getEdges() { throw new Error("not ready"); } };
    expect(noEdgeBetween(failing, { x: 150, y: 150 }, { x: 250, y: 150 }, within)).toBe(false);
  });
});
