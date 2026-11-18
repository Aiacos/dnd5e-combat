import { describe, it, expect } from "vitest";
import { findPath, turningPoints, cellDistance } from "../module/scripts/core/pathfind.mjs";
import {
  footprintGap, approach, chooseBasicAttack, spentMovement, actionSpeed, ownsPlannedMovement } from "../module/scripts/core/movement.mjs";

const key = c => `${c.i},${c.j}`;

/** Monde de test : `#` = mur (case interdite), lettres = repères. */
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
  it("va tout droit quand rien ne gêne", () => {
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

  it("rend null quand la cible est murée", () => {
    const w = world([
      "S.#G",
      "..##"
    ]);
    expect(findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep })).toBeNull();
  });

  it("traverse une case où l'on ne peut pas s'arrêter, sans y finir", () => {
    const w = world(["S.A.G"]);
    const canEnd = c => key(c) !== key(w.marks.A);
    const through = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep, canEnd });
    expect(through.path.map(key)).toContain(key(w.marks.A));
    expect(findPath({ start: w.marks.S, goals: [w.marks.A], canStep: w.canStep, canEnd })).toBeNull();
  });

  it("paie le terrain difficile et l'évite si c'est plus court", () => {
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

  it("préfère la ligne droite à coût égal", () => {
    const w = world([
      ".....",
      "S...G",
      "....."
    ]);
    const r = findPath({ start: w.marks.S, goals: [w.marks.G], canStep: w.canStep });
    expect(r.path.every(c => c.i === 1)).toBe(true);
  });

  it("s'arrête au garde-fou", () => {
    const canStep = () => true;
    expect(findPath({ start: { i: 0, j: 0 }, goals: [{ i: 500, j: 500 }], canStep, maxNodes: 50 })).toBeNull();
  });

  it("déjà arrivé : chemin d'une case", () => {
    const r = findPath({ start: { i: 2, j: 2 }, goals: [{ i: 2, j: 2 }], canStep: () => true });
    expect(r.path).toEqual([{ i: 2, j: 2 }]);
  });
});

describe("turningPoints", () => {
  it("ne garde que les virages", () => {
    const path = [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }, { i: 1, j: 3 }, { i: 2, j: 4 }, { i: 2, j: 5 }];
    expect(turningPoints(path)).toEqual([{ i: 0, j: 0 }, { i: 0, j: 2 }, { i: 2, j: 4 }, { i: 2, j: 5 }]);
  });
  it("cellDistance compte à huit voisins", () => {
    expect(cellDistance({ i: 0, j: 0 }, { i: 3, j: -2 })).toBe(3);
  });
});

describe("approche d'une cible", () => {
  it("écart entre emprises", () => {
    const m = { i: 0, j: 0, w: 1, h: 1 };
    expect(footprintGap(m, { i: 0, j: 0, w: 1, h: 1 })).toBe(0);
    expect(footprintGap(m, { i: 1, j: 1, w: 1, h: 1 })).toBe(1);
    expect(footprintGap(m, { i: 0, j: 3, w: 1, h: 1 })).toBe(3);
    // Grande créature 2×2 en (2,2) : la case (1,1) la touche en diagonale, (2,2) la chevauche.
    expect(footprintGap({ i: 1, j: 1, w: 1, h: 1 }, { i: 2, j: 2, w: 2, h: 2 })).toBe(1);
    expect(footprintGap({ i: 3, j: 3, w: 1, h: 1 }, { i: 2, j: 2, w: 2, h: 2 })).toBe(0);
  });

  it("au contact : s'arrête à côté, jamais dessus", () => {
    const target = { i: 0, j: 5, w: 1, h: 1 };
    const { isGoal, heuristic } = approach(target, { w: 1, h: 1 }, 1);
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 4 });
    expect(isGoal({ i: 0, j: 5 })).toBe(false);
  });

  it("avec allonge de deux cases : s'arrête plus tôt", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 2);
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 3 });
  });

  it("déjà à portée : ne bouge pas", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 1, w: 1, h: 1 }, { w: 1, h: 1 }, 1);
    expect(findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true }).path).toHaveLength(1);
  });

  it("case d'approche occupée : prend la suivante", () => {
    const { isGoal, heuristic } = approach({ i: 0, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 1);
    const canEnd = c => key(c) !== "0,4";
    const r = findPath({ start: { i: 0, j: 0 }, isGoal, heuristic, canStep: () => true, canEnd });
    expect(["1,4", "-1,4"]).toContain(key(r.path.at(-1)));
  });
});

describe("attaque de base", () => {
  it("la mêlée équipée d'abord", () => {
    const pick = chooseBasicAttack([
      { id: "arc", melee: false, equipped: true, sort: 1 },
      { id: "epee", melee: true, equipped: true, sort: 2 },
      { id: "morsure", melee: true, equipped: false, sort: 0 }
    ]);
    expect(pick.id).toBe("epee");
  });
  it("à défaut de mêlée, la distance", () => {
    expect(chooseBasicAttack([{ id: "arc", melee: false, equipped: true, sort: 1 }]).id).toBe("arc");
    expect(chooseBasicAttack([])).toBeNull();
  });
});

describe("findPath — niveaux (P2)", () => {
  // Deux niveaux superposés : « 0 » et « 1 ». Un escalier E relie la case (0,3) de l'un à l'autre.
  const stairs = { i: 0, j: 3 };
  const world = {
    canStep: (from, to) => (to.i >= 0) && (to.j >= 0) && (to.i < 2) && (to.j < 6) && (to.level === from.level),
    transitions: cell => (cell.i === stairs.i) && (cell.j === stairs.j)
      ? [{ cell: { i: cell.i, j: cell.j, level: cell.level === "0" ? "1" : "0" }, cost: 4 }] : []
  };
  it("rejoint une case d'un autre niveau par l'escalier, au coût de la hauteur", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 1, j: 5, level: "1" }], ...world });
    expect(r).not.toBeNull();
    expect(r.path.map(c => `${c.i},${c.j}@${c.level}`)).toEqual(["0,0@0", "0,1@0", "0,2@0", "0,3@0", "0,3@1", "0,4@1", "1,5@1"]);
    expect(r.cost).toBe(3 + 4 + 2);
  });
  it("sans escalier, l'autre niveau est inaccessible", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 1, j: 5, level: "1" }], canStep: world.canStep });
    expect(r).toBeNull();
  });
  it("une case garde son niveau ; les mêmes i, j sur deux niveaux sont deux cases", () => {
    const r = findPath({ start: { i: 0, j: 0, level: "0" }, goals: [{ i: 0, j: 0, level: "1" }], ...world });
    expect(r.path).toHaveLength(8);   // 4 cases à l'aller, l'escalier, 3 cases au retour
    expect(r.path[0]).toEqual({ i: 0, j: 0, level: "0" });
    expect(r.path.at(-1)).toEqual({ i: 0, j: 0, level: "1" });
  });
  it("un chemin sans niveau se comporte comme avant", () => {
    const r = findPath({ start: { i: 0, j: 0 }, goals: [{ i: 0, j: 5 }], canStep: (f, t) => t.i >= 0 && t.j >= 0 && t.i < 2 && t.j < 6 });
    expect(r.path).toHaveLength(6);
    expect(r.path[0]).toEqual({ i: 0, j: 0 });
  });
});

describe("findPath — voisines déjà atteintes", () => {
  /** Générateur pseudo-aléatoire à graine : les mêmes grilles à chaque passe. */
  const rng = seed => () => (seed = ((seed * 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const SIZE = 14;
  const inside = c => (c.i >= 0) && (c.j >= 0) && (c.i < SIZE) && (c.j < SIZE);

  /** Une grille tirée au sort : des murs (cases interdites), du terrain difficile (2), des cloisons entre deux cases voisines. */
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

  /** Le coût le plus bas par une recherche sans ruse (Dijkstra sur une liste), mêmes coûts que `findPath`. */
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

  it("300 grilles tirées au sort : le coût reste le plus bas, le chemin se suit pas à pas", () => {
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
    expect(found).toBeGreaterThan(100);   // le tirage laisse bien des chemins à trouver
  });

  it("ne redemande pas un pas vers une case déjà atteinte à meilleur compte (un `canStep` = un lancer de rayon)", () => {
    // Une salle fermée de 12 × 12, l'arrivée dehors : toutes les cases sont explorées avant de renoncer.
    const room = c => (c.i >= 0) && (c.j >= 0) && (c.i < 12) && (c.j < 12);
    const asked = [];
    const canStep = (from, to) => { asked.push(to); return room(to); };
    expect(findPath({ start: { i: 6, j: 6 }, goals: [{ i: 40, j: 40 }], canStep })).toBeNull();
    // La case de départ est atteinte à coût nul : aucune voisine n'a à y revenir.
    expect(asked.filter(c => (c.i === 6) && (c.j === 6))).toHaveLength(0);
    // Sans le raccourci : 8 demandes par case explorée (1152). Chaque case n'est plus demandée que tant qu'un pas peut l'améliorer.
    expect(asked.length).toBeLessThan(144 * 4);
  });
});

describe("déplacement dépensé (§16.10)", () => {
  it("une téléportation ou un déplacement forcé ne consomme pas de déplacement", () => {
    const history = [{ cost: 10 }, { cost: 30, teleport: true }, { cost: 5 }, { cost: 10, teleport: true }, { cost: NaN }];
    expect(spentMovement(history)).toEqual({ spent: 15, excluded: 40 });
  });
  it("un historique vide : rien", () => {
    expect(spentMovement([])).toEqual({ spent: 0, excluded: 0 });
    expect(spentMovement(undefined)).toEqual({ spent: 0, excluded: 0 });
  });
});

describe("vitesse de l'action de déplacement (§229)", () => {
  const types = { walk: {}, burrow: {}, climb: { walkFallback: true }, fly: {}, jump: {}, swim: { walkFallback: true } };
  const wraith = { walk: 5, fly: 60, swim: 0, burrow: 0, climb: 0 };
  it("en vol, la vitesse de vol ; à pied, la marche", () => {
    expect(actionSpeed(wraith, "fly", types)).toBe(60);
    expect(actionSpeed(wraith, "walk", types)).toBe(5);
    expect(actionSpeed(wraith, null, types)).toBe(5);
  });
  it("nage : la plus grande avec la marche ; vol sans vitesse de vol : 0, comme la règle de dnd5e", () => {
    expect(actionSpeed({ walk: 30, swim: 0 }, "swim", types)).toBe(30);
    expect(actionSpeed({ walk: 30, swim: 40 }, "swim", types)).toBe(40);
    expect(actionSpeed({ walk: 30, fly: 0 }, "fly", types)).toBe(0);
  });
  it("une action qui n'est pas un mode de dnd5e (Éthéré) : la marche", () => {
    expect(actionSpeed({ walk: 30 }, "ethereal", types)).toBe(30);
  });
});

describe("§461 : distance d'une téléportation déclarée", () => {
  it("la distance de l'entrée, sinon la portée de l'activité en longueur, sinon rien", async () => {
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

describe("aperçu du chemin et glisser du cœur", () => {
  const own = { foundPath: [], hidden: true };
  const drag = { foundPath: [], hidden: false };
  it("entrée vide ou la sienne : l'aperçu peut la poser, la remplacer, l'effacer", () => {
    expect(ownsPlannedMovement(undefined, null)).toBe(true);
    expect(ownsPlannedMovement(null, own)).toBe(true);
    expect(ownsPlannedMovement(own, own)).toBe(true);
  });
  it("entrée d'un glisser (cœur, recherche de chemin) : l'aperçu n'y touche pas", () => {
    expect(ownsPlannedMovement(drag, own)).toBe(false);
    expect(ownsPlannedMovement(drag, undefined)).toBe(false);
    expect(ownsPlannedMovement({ ...own }, own)).toBe(false);
  });
});
