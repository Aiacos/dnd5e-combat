/**
 * The probe of the `perf-planpath*` scenarios (issue #92): a script run on the GM client through the connector's `run-script`.
 * One operation per call (`args.op`), each short enough for one connector answer. It only reads: nothing is written to the world,
 * and the functions it wraps to count calls are put back before it returns.
 *
 * It works on any version of the engine: what a version does not have (the open-ground shortcuts, the kept sheets) is reported as
 * absent, so the same scenario compares two engines on the bench (`npm run banc:moteur -- "<worktree>"`).
 *
 * Why loops and not one timed call: Chrome rounds `performance.now()` to 0.1 ms outside isolated pages, and one question to the
 * core costs 0.02 ms. A part of `planPath` is timed by replaying, many times, the exact questions one search asked.
 */
export const PLANPATH_PROBE = `
const base = "/modules/dnd5e-combat/scripts/";
const move = await import(base + "adapter/movement.mjs");
const world = await import(base + "adapter/path-world.mjs");
const sharing = await import(base + "adapter/space-sharing.mjs");
const doc = canvas.scene.tokens.get(args.tokenId);
const object = doc?.object;
if ( !object ) return { error: "no token on the viewed scene" };
const layer = canvas.tokens;
const grid = canvas.scene.grid;
const rect = canvas.dimensions.sceneRect;
const here = move.cellOf(doc);
const goalOf = ([di, dj]) => ({ cells: [{ i: here.i + di, j: here.j + dj }] });
const plan = (to, options={ maxCost: Infinity }) => move.planPath(doc, to, options);
const median = list => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
const timeEach = (fn, n) => { const out = []; for ( let k = 0; k < n; k++ ) { const t = performance.now(); fn(); out.push(performance.now() - t); } return out; };
const perCall = (fn, n) => { const t = performance.now(); for ( let k = 0; k < n; k++ ) fn(); return (performance.now() - t) / n; };
const round = ms => Math.round(ms * 1000) / 1000;
const center = cell => { const p = grid.getTopLeftPoint(cell); return { x: p.x + (grid.sizeX / 2), y: p.y + (grid.sizeY / 2) }; };
const ownK = Math.floor(((doc._source.elevation ?? 0) / grid.distance) + 1e-8);
const has = { shortcuts: (typeof world.occupancyIndex === "function") && (typeof world.noEdgeBetween === "function"),
  keptSheets: typeof sharing.forgetShareKind === "function" };

// The straight open-ground gesture of the issue: four cells in the first direction that arrives in a straight line.
const findStraight = () => [[-4, 0], [4, 0], [0, 4], [0, -4]].find(d => { const p = plan(goalOf(d)); return p?.arrives && (p.waypoints.length === 1); }) ?? null;

if ( args.op === "cold" ) {
  // Nothing has asked for a path on this page yet (the scenario runs first after a page load): the very first calls.
  const first = timeEach(() => move.planPath(doc, goalOf(args.direction), { maxCost: Infinity }), 5);
  return { first: first.map(round), medianOfFive: round(median(first)) };
}

if ( args.op === "warm" ) {
  const straight = findStraight();
  if ( !straight ) return { error: "no straight four-cell route around the token" };
  const to = goalOf(straight);
  for ( let k = 0; k < 50; k++ ) plan(to);
  const calls = timeEach(() => plan(to), 300);
  const out = { direction: straight, tokens: canvas.scene.tokens.size,
    items: [...canvas.scene.tokens].reduce((n, t) => n + (t.actor?.items?.size ?? 0), 0),
    walls: canvas.scene.walls.size, regions: canvas.scene.regions.size,
    medianMs: round(median(calls)), meanMs: round(calls.reduce((a, b) => a + b, 0) / calls.length),
    worldForMs: round(perCall(() => world.worldFor(doc, {}), 300)), has };
  if ( has.keptSheets ) {
    out.rereadMeanMs = round(perCall(() => { sharing.forgetShareKind(); plan(to); }, 300));
    const kept = JSON.stringify(plan(to));
    sharing.forgetShareKind();
    out.sameRouteKeptOrReread = kept === JSON.stringify(plan(to));
  }
  return out;
}

if ( args.op === "parts" ) {
  const straight = findStraight();
  if ( !straight ) return { error: "no straight four-cell route around the token" };
  const to = goalOf(straight);
  // One search with the three questions recorded, then each list replayed alone.
  const asked = { blocking: [], difficult: [], collision: [], hooks: 0 };
  const own = { blocking: layer.isOccupiedGridSpaceBlocking, difficult: layer.isOccupiedGridSpaceDifficult, collision: object.checkCollision, callAll: Hooks.callAll };
  try {
    layer.isOccupiedGridSpaceBlocking = function(...a) { asked.blocking.push(a); return own.blocking.apply(this, a); };
    layer.isOccupiedGridSpaceDifficult = function(...a) { asked.difficult.push(a); return own.difficult.apply(this, a); };
    object.checkCollision = function(...a) { asked.collision.push(a); return own.collision.apply(this, a); };
    Hooks.callAll = function(name, ...a) { if ( String(name).startsWith("dnd5e.determineOccupiedGridSpace") ) asked.hooks++; return own.callAll.call(this, name, ...a); };
    plan(to);
  }
  finally {
    // The wrappers were own properties hiding the class methods: removing them puts the methods back.
    delete layer.isOccupiedGridSpaceBlocking;
    delete layer.isOccupiedGridSpaceDifficult;
    delete object.checkCollision;
    Hooks.callAll = own.callAll;
  }
  const N = 200;
  const others = canvas.scene.tokens.filter(t => t !== doc);
  return { has,
    blocking: { calls: asked.blocking.length, msPerPlan: round(perCall(() => { for ( const a of asked.blocking ) layer.isOccupiedGridSpaceBlocking(...a); }, N)) },
    difficult: { calls: asked.difficult.length, msPerPlan: round(perCall(() => { for ( const a of asked.difficult ) layer.isOccupiedGridSpaceDifficult(...a); }, N)) },
    collision: { calls: asked.collision.length, msPerPlan: round(perCall(() => { for ( const a of asked.collision ) object.checkCollision(...a); }, N)) },
    occupiedHooks: asked.hooks,
    sheets: { actors: others.length, msPerPlan: round(perCall(() => { sharing.forgetShareKind?.(); sharing.shareKindOf(doc.actor); for ( const t of others ) sharing.shareKindOf(t.actor); }, N)) },
    worldForMs: round(perCall(() => world.worldFor(doc, {}), N)),
    planMs: round(perCall(() => plan(to), N)) };
}

if ( args.op === "hover" ) {
  // What one hover of the path preview really costs in combat: a search under a finite budget (the core then measures and cuts the
  // route), with doors, then the ruler drawn from it. The preview is cleared before returning.
  const straight = findStraight();
  if ( !straight ) return { error: "no straight four-cell route around the token" };
  const to = goalOf(straight);
  const options = { maxCost: 6 * grid.distance, throughDoors: true };
  for ( let k = 0; k < 30; k++ ) plan(to, options);
  const found = plan(to, options);
  const out = { budgetedPlanMs: round(perCall(() => plan(to, options), 200)), unboundedPlanMs: round(perCall(() => plan(to), 200)) };
  try { out.previewMs = round(perCall(() => move.previewPath(doc, found), 100)); }
  finally { move.previewPath(doc, null); }
  return out;
}

if ( args.op === "routes" ) {
  // Every goal around the token, with and without doors: the routes two engines must agree on.
  const R = args.radius ?? 5;
  const lines = [];
  let none = 0;
  for ( let di = -R; di <= R; di++ ) for ( let dj = -R; dj <= R; dj++ ) {
    if ( !di && !dj ) continue;
    for ( const throughDoors of [false, true] ) {
      const p = plan(goalOf([di, dj]), { maxCost: Infinity, throughDoors });
      if ( !p ) none++;
      lines.push(di + "," + dj + (throughDoors ? "d" : "") + ":" + (p ? p.waypoints.map(w => w.x + "/" + w.y + "/" + (w.elevation ?? "") + (w.through ? "t" : "") + "+" + (w.stops?.length ?? 0)).join(">") + (p.arrives ? "" : "!") + (p.door ? "#" + p.door.id : "") : "none"));
    }
  }
  let hash = 5381;
  for ( const ch of lines.join("|") ) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
  return { routes: lines.length, none, hash: hash.toString(16), sample: lines.filter((l, n) => (n % 37) === 0).slice(0, 8) };
}

if ( args.op === "cells" ) {
  // The shortcut for occupied cells against dnd5e, on every cell of the scene: where the engine says "no other token can occupy
  // this cell", dnd5e's own answer must be the answer of its hook alone, for both questions, as GM and as preview.
  if ( !has.shortcuts ) return { skipped: "no open-ground shortcut in this engine" };
  const mayHold = world.occupancyIndex(layer, object, grid);
  if ( !mayHold ) return { skipped: "token layer unreadable: everything is asked to dnd5e" };
  const first = grid.getOffset({ x: rect.x + 1, y: rect.y + 1 });
  const last = grid.getOffset({ x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 });
  let asked = 0, shortcut = 0;
  const differences = [];
  for ( let i = first.i; i <= last.i; i++ ) for ( let j = first.j; j <= last.j; j++ ) {
    for ( const preview of [false, true] ) for ( const [method, hook] of [["isOccupiedGridSpaceBlocking", "dnd5e.determineOccupiedGridSpaceBlocking"], ["isOccupiedGridSpaceDifficult", "dnd5e.determineOccupiedGridSpaceDifficult"]] ) {
      asked++;
      if ( mayHold({ i, j }) ) continue;
      shortcut++;
      const space = { i, j, k: ownK };
      const found = new Set();
      Hooks.callAll(hook, space, object, { preview }, found);
      const theirs = layer[method](space, object, { preview }) === true;
      if ( theirs !== (found.size > 0) ) differences.push({ i, j, preview, method, theirs });
    }
  }
  return { asked, shortcut, differences: differences.length, first: differences.slice(0, 5) };
}

if ( args.op === "steps" ) {
  // The shortcut for walls against the core, on every step between neighbouring cells of the token's level: where the engine says
  // "no edge on this step", the core must find no collision.
  if ( !has.shortcuts ) return { skipped: "no open-ground shortcut in this engine" };
  const edges = canvas.scene.levels?.get?.(doc._source.level)?.edges ?? null;
  const first = grid.getOffset({ x: rect.x + 1, y: rect.y + 1 });
  const last = grid.getOffset({ x: rect.x + rect.width - 1, y: rect.y + rect.height - 1 });
  // A band of cells one cell wider than the scene: the steps that cross its boundary are part of the question.
  const rows = [first.i - 1, last.i + 1];
  const from = Math.max(rows[0], args.fromRow ?? rows[0]);
  const to = Math.min(rows[1], from + (args.rows ?? 1000) - 1);
  let steps = 0, shortcut = 0, collisions = 0;
  const wrong = [];
  for ( let i = from; i <= to; i++ ) for ( let j = first.j - 1; j <= last.j + 1; j++ ) {
    const a = center({ i, j });
    for ( const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] ) {
      const b = center({ i: i + di, j: j + dj });
      steps++;
      const hit = object.checkCollision(b, { origin: a, type: "move", mode: "any" }) === true;
      if ( hit ) collisions++;
      if ( !world.noEdgeBetween(edges, a, b, rect) ) continue;
      shortcut++;
      if ( hit ) wrong.push({ i, j, di, dj });
    }
  }
  return { rows, from, to, done: to >= rows[1], steps, shortcut, collisions, wrong: wrong.length, first: wrong.slice(0, 5) };
}

return { error: "unknown op" };
`;

/**
 * Plays the probe's operations for one token and logs what it measured. Returns every answer.
 * @param {object} ctx        The scenario context (tools/scenario.mjs).
 * @param {{id: string}} token
 * @param {object} [options]
 * @param {boolean} [options.cold=true]  Time the very first calls of the page (only meaningful for the first scenario of a pass).
 */
export async function probePlanPath(ctx, token, { cold=true }={}) {
  const ask = async (op, more={}) => {
    const r = await ctx.call("run-script", { code: PLANPATH_PROBE, args: { op, tokenId: token.id, ...more }, waitMs: 20000 });
    const out = r?.result ?? r;
    if ( out?.error ) throw new Error(`planPath probe, ${op}: ${out.error}`);
    return out;
  };
  const out = {};
  // The cold calls first, straight up (the direction is not searched: a search would warm the code up).
  if ( cold ) { out.cold = await ask("cold", { direction: [-4, 0] }); ctx.log(`cold ${JSON.stringify(out.cold)}`); }
  out.warm = await ask("warm");
  ctx.log(`warm ${JSON.stringify(out.warm)}`);
  out.parts = await ask("parts");
  ctx.log(`parts ${JSON.stringify(out.parts)}`);
  out.hover = await ask("hover");
  ctx.log(`hover ${JSON.stringify(out.hover)}`);
  out.routes = await ask("routes");
  ctx.log(`routes ${JSON.stringify({ ...out.routes, sample: undefined })}`);
  out.cells = await ask("cells");
  ctx.log(`cells ${JSON.stringify(out.cells)}`);
  // The steps by bands of rows: one connector answer each.
  const steps = { steps: 0, shortcut: 0, collisions: 0, wrong: 0, first: [] };
  for ( let fromRow; ; ) {
    const band = await ask("steps", { fromRow, rows: 12 });
    if ( band.skipped ) { Object.assign(steps, band); break; }
    for ( const key of ["steps", "shortcut", "collisions", "wrong"] ) steps[key] += band[key];
    steps.first.push(...band.first);
    if ( band.done ) break;
    fromRow = band.to + 1;
  }
  steps.first = steps.first.slice(0, 5);
  out.steps = steps;
  ctx.log(`steps ${JSON.stringify(steps)}`);
  return out;
}

/** What both scenarios hold: a cache or a shortcut never changes an answer. */
export function expectSameAnswers(ctx, out) {
  ctx.expect(Number.isFinite(out.warm?.medianMs), `a straight four-cell route is found and timed (${out.warm?.medianMs} ms, median of 300)`);
  if ( out.warm?.has?.keptSheets ) ctx.expect(out.warm.sameRouteKeptOrReread === true, "the route is identical whether the other tokens' sheets are kept or read again");
  if ( !out.cells?.skipped ) ctx.expect(out.cells.differences === 0, `occupied cells: where the engine does not ask dnd5e, dnd5e would answer the same (${out.cells.shortcut} of ${out.cells.asked} questions, ${out.cells.differences} difference(s) ${JSON.stringify(out.cells.first)})`);
  if ( !out.steps?.skipped ) ctx.expect(out.steps.wrong === 0, `walls: where the engine does not ask the core, the core finds no collision (${out.steps.shortcut} of ${out.steps.steps} steps, ${out.steps.collisions} collision(s) on the level, ${out.steps.wrong} wrong ${JSON.stringify(out.steps.first)})`);
}
