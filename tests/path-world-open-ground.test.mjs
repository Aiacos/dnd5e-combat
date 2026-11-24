/**
 * Issue #92 : sur terrain dégagé, le coût fixe d'un chemin était celui des questions posées pour chaque case — à dnd5e (« un
 * token occupe-t-il cette case ? », une recherche dans le quadtree des tokens) et au cœur (« un mur entre ces deux cases ? »,
 * un polygone construit par pas). Deux raccourcis qui ne répondent que là où la réponse est connue d'avance.
 */
import { describe, it, expect } from "vitest";

globalThis.PIXI ??= { Rectangle: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } } };
const { occupancyIndex, noEdgeBetween } = await import("../module/scripts/adapter/path-world.mjs");

const SIZE = 100;
const grid = { getOffset: ({ x, y }) => ({ i: Math.floor(y / SIZE), j: Math.floor(x / SIZE) }) };
/** Un token de `w` × `h` cases dont le rectangle est en (i, j) ; `cells` : les cases que dnd5e lui compte. */
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

describe("occupancyIndex — où dnd5e peut trouver un occupant", () => {
  it("les cases d'un autre token, pas ses voisines que son rectangle ne fait que toucher", () => {
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

  it("le token qui se déplace ne compte pas : sa propre case n'est occupée par personne d'autre", () => {
    const self = tokenAt(2, 2);
    expect(occupancyIndex({ placeables: [self] }, self, grid)({ i: 2, j: 2 })).toBe(false);
  });

  it("les cases d'un token ne sont calculées que si l'on demande une case que son rectangle touche, et une seule fois", () => {
    const self = tokenAt(0, 0);
    const far = tokenAt(8, 8);
    const mayHold = occupancyIndex({ placeables: [self, far] }, self, grid);
    expect(mayHold({ i: 1, j: 1 })).toBe(false);
    expect(far.document.asked ?? 0).toBe(0);
    expect(mayHold({ i: 8, j: 8 })).toBe(true);
    expect(mayHold({ i: 8, j: 9 })).toBe(false);
    expect(far.document.asked).toBe(1);
  });

  it("un token qui ne se lit pas : la case que son rectangle touche est laissée à dnd5e", () => {
    const self = tokenAt(0, 0);
    const odd = tokenAt(3, 3);
    odd.document.getOccupiedGridSpaceOffsets = () => { throw new Error("no shape"); };
    const mayHold = occupancyIndex({ placeables: [self, odd] }, self, grid);
    expect(mayHold({ i: 3, j: 3 })).toBe(true);
    expect(mayHold({ i: 4, j: 4 })).toBe(true);    // son rectangle la touche (un pixel de marge) : on ne sait pas
    expect(mayHold({ i: 6, j: 6 })).toBe(false);
  });

  it("un rectangle illisible : null, tout est demandé à dnd5e", () => {
    const self = tokenAt(0, 0);
    expect(occupancyIndex({ placeables: [self, { bounds: null, document: {} }] }, self, grid)).toBeNull();
  });
});

describe("noEdgeBetween — aucun mur à percuter sur ce pas", () => {
  const within = { contains: (x, y) => (x >= 0) && (x < 1000) && (y >= 0) && (y < 1000) };
  const edgesWith = found => ({ asked: [],
    getEdges(rect, options) { this.asked.push({ rect, options }); return new Set(found); } });

  it("aucune arête dans le rectangle du pas (deux pixels de marge, bords de scène écartés) : rien à percuter", () => {
    const edges = edgesWith([]);
    expect(noEdgeBetween(edges, { x: 150, y: 150 }, { x: 250, y: 250 }, within)).toBe(true);
    expect(edges.asked).toEqual([{ rect: { x: 148, y: 148, width: 104, height: 104 },
      options: { includeInnerBounds: false, includeOuterBounds: false } }]);
  });

  it("une arête dans ce rectangle : le test du cœur décide", () => {
    expect(noEdgeBetween(edgesWith([{ id: "wall" }]), { x: 150, y: 150 }, { x: 250, y: 150 }, within)).toBe(false);
  });

  it("un pas qui sort de la scène ou y rentre percute ses bords, que le quadtree ne contient pas : le test du cœur décide", () => {
    const edges = edgesWith([]);
    expect(noEdgeBetween(edges, { x: 950, y: 150 }, { x: 1050, y: 150 }, within)).toBe(false);
    expect(noEdgeBetween(edges, { x: -50, y: 150 }, { x: 50, y: 150 }, within)).toBe(false);
    expect(edges.asked).toEqual([]);
  });

  it("sans quadtree des arêtes, ou s'il échoue : le test du cœur décide", () => {
    expect(noEdgeBetween(null, { x: 150, y: 150 }, { x: 250, y: 150 }, within)).toBe(false);
    const failing = { getEdges() { throw new Error("not ready"); } };
    expect(noEdgeBetween(failing, { x: 150, y: 150 }, { x: 250, y: 150 }, within)).toBe(false);
  });
});
