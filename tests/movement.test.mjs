import { describe, it, expect } from "vitest";
import { findPath, turningPoints, cellDistance } from "../module/scripts/core/pathfind.mjs";
import {
  footprintGap, approach, chooseBasicAttack, spentMovement, actionSpeed, ownsPlannedMovement } from "../module/scripts/core/movement.mjs";

const key = c => `${c.i},${c.j}`;

/** Test world: `#` = wall (forbidden cell), letters = landmarks. */
function world(rows) {
  const blocked = new Set();
  const marks = {};
  rows.forEach((row, i) => [...row].forEach((ch, j) => {
    if ( ch === "#" ) blocked.add(`${i},${j}`);
    else if ( ch !== "." ) marks[ch] = { i, j };
  }));
  const inside = c => (c.i >= 0) && (c.j >= 0) && (c.i < rows.length) && (c.j < rows[0].length);
  return { marks, canStep: (from, to) => inside(to) && !blocked.has(key(to)) };
}

describe("findPath", () => {
  it("goes straight when nothing is in the way", () => {
    const w = world(["S....G"]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r.path).toHaveLength(6);
    expect(r.cost).toBe(5);
  });

  it("contourne un mur", () => {
    const w = world([
      "S.#..",
      "..#.G",
      "..#..",
      "....."
    ]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r).not.toBeNull();
    expect(r.path.some(c => c.i === 3)).toBe(true);
    expect(r.path.every(c => w.canStep(c, c))).toBe(true);
  });

  it("returns null when the target is walled in", () => {
    const w = world([
      "S.#G",
      "..##"
    ]);
    expect(findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep })).toBeNull();
  });

  it("crosses a cell where one cannot stop, without ending there", () => {
    const w = world(["S.A.G"]);
    const canEnd = c => key(c) !== key(w.marks.A);
    const through = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep, canEnd });
    expect(through.path.map(key)).toContain(key(w.marks.A));
    expect(findPath({ start: w.marks.S, goals: [w.marks.A], canStep: w.canStep, canEnd })).toBeNull();
  });

  it("pays for Difficult Terrain and avoids it if that is shorter", () => {
    const w = world([
      "S...G",
      "....."
    ]);
    const difficult = new Set(["0,1", "0,2", "0,3"]);
    const stepCost = (from, to) => difficult.has(key(to)) ? 2 : 1;
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep, stepCost });
    expect(r.cost).toBe(4);
    expect(r.path.some(c => c.i === 1)).toBe(true);
  });

  it("prefers the straight line at equal cost", () => {
    const w = world([
      ".....",
      "S...G",
      "....."
    ]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r.path.every(c => c.i === 1)).toBe(true);
  });

  it("stops at the safeguard", () => {
    const canStep = () => true;
    expect(findPath({ start: { i: 0, j: 0 }, goals: [{ i: 500, j: 500 }], canStep, maxNodes: 50 })).toBeNull();
  });

  it("already arrived: a one-cell path", () => {
    const r = findPath({ start: { i: 2, j: 2 }, goals: [{ i: 2, j: 2 }], canStep: () => true });
    expect(r.path).toEqual([{ i: 2, j: 2 }]);
  });
});

describe("turningPoints", () => {
  it("ne garde que les virages", () => {
    const path = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 1, j: 3 }, { i: 2, j: 4 }, { i: 2, j: 5 }];
    expect(turningPoints(path)).toEqual([{ i: 0, j: 0 }, { i: 0, j: 2 }, { i: 2, j: 4 }, { i: 2, j: 5 }]);
  });
  it("cellDistance counts with eight neighbors", () => {
    expect(cellDistance({ i: 0, j: 0 }, { i: 3, j: -2 })).toBe(3);
  });
});

describe("approche d'une cible", () => {
  it("gap between footprints", () => {
    const m = { i: 0, j: 0, w: 1, h: 1 };
    expect(footprintGap(m, { i: 0, j: 0, w: 1, h: 1 })).toBe(0);
    expect(footprintGap(m, { i: 1, j: 1, w: 1, h: 1 })).toBe(1);
    expect(footprintGap(m, { i: 0, j: 3, w: 1, h: 1 })).toBe(3);
    // Large creature 2×2 at (2,2): the cell (1,1) touches it diagonally, (2,2) overlaps it.
    expect(footprintGap({ i: 1, j: 1, w: 1, h: 1 }, { i: 2, j: 2, w: 2, h: 2 })).toBe(1);
    expect(footprintGap({ i: 3, j: 3, w: 1, h: 1 }, { i: 2, j: 2, w: 2, h: 2 })).toBe(0);
  });

  it("in contact: stops next to it, never on top", () => {
    const target = { i: 0, j: 5, w: 1, h: 1 };
    const { isGoal, heuristic } = approach(target, { w: 1, h: 1 }, 1);
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 4 });
    expect(isGoal({ i: 0, j: 5 })).toBe(false);
  });

  it("with a reach of two cells: stops earlier", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 2);
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 3 });
  });

  it("already in range: does not move", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 1, w: 1, h: 1 }, { w: 1, h: 1 }, 1);
    expect(findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true }).path).toHaveLength(1);
  });

  it("approach cell occupied: takes the next one", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 1);
    const canEnd = c => key(c) !== "0,4";
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true, canEnd });
    expect(["1,4", "-1,4"]).toContain(key(r.path.at(-1)));
  });
});

describe("attaque de base", () => {
  it("equipped melee first", () => {
    const pick = chooseBasicAttack([
      { id: "arc", melee: false, equipped: true, sort: 1 },
      { id: "epee", melee: true, equipped: true, sort: 2 },
      { id: "morsure", melee: true, equipped: false, sort: 0 }
    ]);
    expect(pick.id).toBe("epee");
  });
  it("failing melee, the range", () => {
    expect(chooseBasicAttack([{ id: "arc", melee: false, equipped: true, sort: 1 }]).id).toBe("arc");
    expect(chooseBasicAttack([])).toBeNull();
  });
});

describe("findPath — niveaux (P2)", () => {
  // Two superimposed levels: "0" and "1". A staircase E links cell (0,3) of one to the other.
  const stairs = { i: 0, j: 3 };
  const world = {
    canStep: (from, to) => (to.i >= 0) && (to.j >= 0) && (to.i < 2) && (to.j < 6) && (to.level === from.level),
    transitions: cell => (cell.i === stairs.i) && (cell.j === stairs.j)
      ? [{ cell: { i: cell.i, j: cell.j, level: cell.level === "0" ? "1" : "0" }, cost: 4 }] : []
  };
  it("reaches a cell on another level by the staircase, at the cost of the height", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 1, j: 5, level: "1" }], ...world });
    expect(r).not.toBeNull();
    expect(r.path.map(c => `${c.i},${c.j}@${c.level}`)).toEqual(["0,0@0", "0,1@0", "0,2@0", "0,3@0", "0,3@1", "0,4@1", "1,5@1"]);
    expect(r.cost).toBe(3 + 4 + 2);
  });
  it("sans escalier, l'autre niveau est inaccessible", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 1, j: 5, level: "1" }], canStep: world.canStep });
    expect(r).toBeNull();
  });
  it("a cell keeps its level; the same i, j on two levels are two cells", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 0, j: 0, level: "1" }], ...world });
    expect(r.path).toHaveLength(8);   // 4 cells out, the staircase, 3 cells back
    expect(r.path[0]).toEqual({ i: 0, j: 0, level: "0" });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 0, level: "1" });
  });
  it("un chemin sans niveau se comporte comme avant", () => {
    const r = findPath({ start: { i: 0, j: 0 }, goals: [{ i: 0, j: 5 }], canStep: (f, t) => t.i >= 0 && t.j >= 0 && t.i < 2 && t.j < 6 });
    expect(r.path).toHaveLength(6);
    expect(r.path[0]).toEqual({ i: 0, j: 0 });
  });
});

describe("findPath — neighbors already reached", () => {
  /** Seeded pseudo-random generator: the same grids on every pass. */
  const rng = seed => () => (seed = ((seed * 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const SIZE = 14;
  const inside = c => (c.i >= 0) && (c.j >= 0) && (c.i < SIZE) && (c.j < SIZE);

  /** A randomly drawn grid: walls (forbidden cells), Difficult Terrain (2), partitions between two neighboring cells. */
  function randomWorld(seed) {
    const r = rng(seed);
    const wall = new Set(), slow = new Set(), fence = new Set();
    for ( let i = 0; i < SIZE; i++ ) for ( let j = 0; j < SIZE; j++ ) {
      const x = r();
      if ( x < 0.22 ) wall.add(`${i},${j}`);
      else if ( x < 0.37 ) slow.add(`${i},${j}`);
      if ( r() < 0.1 ) fence.add(`${i},${j}>${i},${j + 1}`);
    }
    const start = { i: Math.floor(r() * SIZE), j: Math.floor(r() * SIZE) };
    const goal = { i: Math.floor(r() * SIZE), j: Math.floor(r() * SIZE) };
    wall.delete(key(start));
    wall.delete(key(goal));
    const fenced = (a, b) => fence.has(`${key(a)}>${key(b)}`) || fence.has(`${key(b)}>${key(a)}`);
    const canStep = (from, to) => inside(to) && !wall.has(key(to)) && !fenced(from, to);
    const stepCost = (from, to) => slow.has(key(to)) ? 2 : 1;
    return { start, goal, canStep, stepCost };
  }

  /** The lowest cost by a naive search (Dijkstra on a list), same costs as `findPath`. */
  function cheapest({ start, goal, canStep, stepCost }) {
    const dist = new Map([[key(start), 0]]);
    const todo = [start];
    while ( todo.length ) {
      todo.sort((a, b) => dist.get(key(a)) - dist.get(key(b)));
      const cell = todo.shift();
      if ( key(cell) === key(goal) ) return Math.round(dist.get(key(cell)));
      for ( let di = -1; di <= 1; di++ ) for ( let dj = -1; dj <= 1; dj++ ) {
        const next = { i: cell.i + di, j: cell.j + dj };
        if ( (!di && !dj) || !canStep(cell, next) ) continue;
        const d = dist.get(key(cell)) + stepCost(cell, next) + ((di && dj) ? 0.001 : 0);
        if ( d >= (dist.get(key(next)) ?? Infinity) ) continue;
        dist.set(key(next), d);
        if ( !todo.some(c => key(c) === key(next)) ) todo.push(next);
      }
    }
    return null;
  }

  it("300 randomly drawn grids: the cost stays the lowest, the path can be followed step by step", () => {
    let found = 0;
    for ( let seed = 1; seed <= 300; seed++ ) {
      const w = randomWorld(seed);
      const r = findPath({ start: w.start, goals: [w.goal], canStep: w.canStep, stepCost: w.stepCost });
      const expected = cheapest(w);
      expect(r?.cost ?? null, `grille ${seed}`).toBe(expected);
      if ( !r ) continue;
      found++;
      expect(r.path[0], `grille ${seed}`).toEqual(w.start);
      expect(r.path.at(-1), `grille ${seed}`).toEqual(w.goal);
      let cost = 0;
      for ( let n = 1; n < r.path.length; n++ ) {
        expect(cellDistance(r.path[n - 1], r.path[n]), `grille ${seed}, pas ${n}`).toBe(1);
        expect(w.canStep(r.path[n - 1], r.path[n]), `grille ${seed}, pas ${n}`).toBe(true);
        cost += w.stepCost(r.path[n - 1], r.path[n]);
      }
      expect(cost, `grille ${seed}`).toBe(r.cost);
    }
    expect(found).toBeGreaterThan(100);   // the draw leaves plenty of paths to find
  });

  it("does not ask again for a step toward a cell already reached at a better cost (a `canStep` = a ray cast)", () => {
    // A closed room of 12 × 12, the arrival outside: all cells are explored before giving up.
    const room = c => (c.i >= 0) && (c.j >= 0) && (c.i < 12) && (c.j < 12);
    const asked = [];
    const canStep = (from, to) => { asked.push(to); return room(to); };
    expect(findPath({ start: { i: 6, j: 6 }, goals: [{ i: 40, j: 40 }], canStep })).toBeNull();
    // The starting cell is reached at zero cost: no neighbor has to come back to it.
    expect(asked.filter(c => (c.i === 6) && (c.j === 6))).toHaveLength(0);
    // Without the shortcut: 8 requests per explored cell (1152).
    // Each cell is now requested only as long as a step can improve it.
    expect(asked.length).toBeLessThan(144 * 4);
  });
});

describe("movement spent (§16.10)", () => {
  it("a teleportation or forced movement does not consume movement", () => {
    const history = [{ cost: 10 }, { cost: 30, teleport: true }, { cost: 5 }, { cost: 10, teleport: true }, { cost: NaN }];
    expect(spentMovement(history)).toEqual({ spent: 15, excluded: 40 });
  });
  it("un historique vide : rien", () => {
    expect(spentMovement([])).toEqual({ spent: 0, excluded: 0 });
    expect(spentMovement(undefined)).toEqual({ spent: 0, excluded: 0 });
  });
});

describe("speed of the movement action (§229)", () => {
  const types = { walk: {}, burrow: {}, climb: { walkFallback: true }, fly: {}, jump: {}, swim: { walkFallback: true } };
  const wraith = { walk: 5, fly: 60, swim: 0, burrow: 0, climb: 0 };
  it("flying, the flying speed; on foot, the walk", () => {
    expect(actionSpeed(wraith, "fly", types)).toBe(60);
    expect(actionSpeed(wraith, "walk", types)).toBe(5);
    expect(actionSpeed(wraith, null, types)).toBe(5);
  });
  it("swim: the greater with the walk; fly without a flying speed: 0, like dnd5e's rule", () => {
    expect(actionSpeed({ walk: 30, swim: 0 }, "swim", types)).toBe(30);
    expect(actionSpeed({ walk: 30, swim: 40 }, "swim", types)).toBe(40);
    expect(actionSpeed({ walk: 30, fly: 0 }, "fly", types)).toBe(0);
  });
  it("an action that is not a dnd5e mode (Ethereal): the walk", () => {
    expect(actionSpeed({ walk: 30 }, "ethereal", types)).toBe(30);
  });
});

describe("§461: distance of a declared teleportation", () => {
  it("the entry's distance, otherwise the activity's range in length, otherwise nothing", async () => {
    const { teleportReach } = await import("../module/scripts/core/movement.mjs");
    expect(teleportReach({ distance: 30, units: "ft" }, { value: 60, units: "ft" })).toEqual({ distance: 30, units: "ft" });
    expect(teleportReach({ activity: "aaaaaaaaaaaaaaaa" }, { value: "40", units: "ft" })).toEqual({ distance: 40, units: "ft" });
    expect(teleportReach({ activity: "aaaaaaaaaaaaaaaa" }, { value: 12, units: "m" })).toEqual({ distance: 12, units: "m" });
    expect(teleportReach({ activity: "aaaaaaaaaaaaaaaa" }, { units: "self" })).toBeNull();
    expect(teleportReach({ activity: "aaaaaaaaaaaaaaaa" }, { value: "", units: "ft" })).toBeNull();
    expect(teleportReach({ activity: "aaaaaaaaaaaaaaaa" }, null)).toBeNull();
    expect(teleportReach(null, { value: 30, units: "ft" })).toBeNull();
  });
});

describe("path preview and the core's drag", () => {
  const own = { foundPath: [], hidden: true };
  const drag = { foundPath: [], hidden: false };
  it("empty entry or its own: the preview may place it, replace it, clear it", () => {
    expect(ownsPlannedMovement(undefined, null)).toBe(true);
    expect(ownsPlannedMovement(null, own)).toBe(true);
    expect(ownsPlannedMovement(own, own)).toBe(true);
  });
  it("a drag's entry (core, pathfinding): the preview does not touch it", () => {
    expect(ownsPlannedMovement(drag, own)).toBe(false);
    expect(ownsPlannedMovement(drag, undefined)).toBe(false);
    expect(ownsPlannedMovement({ ...own }, own)).toBe(false);
  });
});
