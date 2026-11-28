/**
 * Pathfinding on a square grid (A*, eight neighbors). Pure core: the world is described by
 * functions supplied by the caller (walls, occupied cells, terrain cost).
 *
 * The Foundry V14 core has no pathfinder: `Token#findMovementPath` returns the straight line,
 * stopped at the first wall (client/canvas/placeables/token.mjs:3397). It is an extension point.
 */

// P2: a cell carries its level (`level`, optional) — two cells with the same i, j at different levels are two nodes.
const key = c => `${c.i},${c.j},${c.level ?? ""}`;

const NEIGHBOURS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1]
];

/** Chebyshev distance between two cells: the number of steps with eight neighbors. */
export function cellDistance(a, b) {
  return Math.max(Math.abs(a.i - b.i), Math.abs(a.j - b.j));
}

/** Minimal binary heap, on the priority `f`. */
class Heap {
  #items = [];
  get size() { return this.#items.length; }
  push(item) {
    const a = this.#items;
    a.push(item);
    let n = a.length - 1;
    while ( n > 0 ) {
      const p = (n - 1) >> 1;
      if ( a[p].f <= a[n].f ) break;
      [a[p], a[n]] = [a[n], a[p]];
      n = p;
    }
  }
  pop() {
    const a = this.#items;
    const top = a[0];
    const last = a.pop();
    if ( a.length ) {
      a[0] = last;
      let n = 0;
      for ( ;; ) {
        const l = (2 * n) + 1;
        const r = l + 1;
        let m = n;
        if ( (l < a.length) && (a[l].f < a[m].f) ) m = l;
        if ( (r < a.length) && (a[r].f < a[m].f) ) m = r;
        if ( m === n ) break;
        [a[m], a[n]] = [a[n], a[m]];
        n = m;
      }
    }
    return top;
  }
}

/**
 * @param {object} query
 * @param {{i:number,j:number}} query.start
 * @param {{i:number,j:number}[]} [query.goals]     Acceptable arrival cells. Or else:
 * @param {(cell) => boolean} [query.isGoal]        Arrival test (approach zone of a target), with
 * @param {(cell) => number} [query.heuristic]      its estimate of the remaining steps, never overestimated.
 * @param {(from, to) => boolean} query.canStep     Can one pass from `from` to its neighbor `to`? (walls, enemies)
 * @param {(cell) => boolean} [query.canEnd]        Can one stop on this cell? (an ally can be crossed, not stopped on)
 * @param {(from, to) => number} [query.stepCost]   Cost of a step, 1 by default (2 on Difficult Terrain); never less than 1.
 * @param {(cell) => {cell: object, cost: number}[]} [query.transitions]  Off-grid neighbors of a cell (P2):
 *   the same cell on another level via a staircase, at the cost of the height crossed. A cell keeps the
 *   `level` of the one it came from; only a transition changes it.
 * @param {number} [query.maxNodes]                 Safeguard: number of cells explored.
 * @returns {{path: {i:number,j:number}[], cost: number}|null}  The path, start included, or null.
 */
export function findPath({ start, goals, isGoal, heuristic, canStep, canEnd=() => true, stepCost=() => 1, transitions=null, maxNodes=6000 }) {
  let arrived = isGoal ? (c => isGoal(c) && canEnd(c)) : null;
  let h = heuristic ?? (() => 0);
  if ( !arrived ) {
    const targets = (goals ?? []).filter(canEnd);
    if ( !targets.length ) return null;
    const goalKeys = new Set(targets.map(key));
    arrived = c => goalKeys.has(key(c));
    h = c => {
      let best = Infinity;
      for ( const g of targets ) best = Math.min(best, cellDistance(c, g));
      return best;
    };
  }
  if ( arrived(start) ) return { path: [{ ...start }], cost: 0 };

  const open = new Heap();
  const best = new Map([[key(start), 0]]);
  const parent = new Map();
  open.push({ cell: start, g: 0, f: h(start) });
  let explored = 0;

  while ( open.size ) {
    const { cell, g } = open.pop();
    const k = key(cell);
    if ( g > (best.get(k) ?? Infinity) ) continue;   // stale entry
    if ( arrived(cell) ) {
      const path = [cell];
      for ( let p = parent.get(k); p; p = parent.get(key(p)) ) path.unshift(p);
      return { path, cost: Math.round(g) };
    }
    if ( ++explored > maxNodes ) return null;
    const relax = (next, ng) => {
      const nk = key(next);
      if ( ng >= (best.get(nk) ?? Infinity) ) return;
      best.set(nk, ng);
      parent.set(nk, cell);
      open.push({ cell: next, g: ng, f: ng + h(next) });
    };
    for ( const [di, dj] of NEIGHBOURS ) {
      const next = { i: cell.i + di, j: cell.j + dj };
      if ( cell.level !== undefined ) next.level = cell.level;
      // Already reached at a cost that a step from here cannot beat (a step costs at least 1): no point asking whether one can
      // pass — `canStep` ends in a core raycast, and `relax` would discard this step anyway.
      if ( g + 1 + ((di && dj) ? 0.001 : 0) >= (best.get(key(next)) ?? Infinity) ) continue;
      if ( !canStep(cell, next) ) continue;
      // A diagonal costs a touch more: at equal cost the straightest path is preferred.
      relax(next, g + stepCost(cell, next) + ((di && dj) ? 0.001 : 0));
    }
    // P2: a staircase, a ladder — the same cell on another level.
    if ( transitions ) for ( const { cell: next, cost } of transitions(cell) ) relax(next, g + cost);
  }
  return null;
}

/** Removes the aligned intermediate cells: only the start, the turns and the arrival remain. */
export function turningPoints(path) {
  if ( path.length <= 2 ) return path.slice();
  const out = [path[0]];
  for ( let n = 1; n < path.length - 1; n++ ) {
    const a = path[n - 1], b = path[n], c = path[n + 1];
    if ( ((b.i - a.i) !== (c.i - b.i)) || ((b.j - a.j) !== (c.j - b.j)) ) out.push(b);
  }
  out.push(path.at(-1));
  return out;
}
