/**
 * Movement as seen from Foundry V14 and dnd5e 6.0: path on the scene, preview, execution.
 *
 * Verified:
 *  - the core has no pathfinder: `Token#findMovementPath` returns the straight line stopped at the
 *    first wall (client/canvas/placeables/token.mjs:3397). The engine's A* (core/pathfind.mjs)
 *    produces the waypoints; the core has the last word at execution
 *  - walls: `Token#checkCollision(centre d'arrivée, { origin: centre de départ })` (token.mjs:2761),
 *    insensitive to animation — in the token's level only; for a cell of another level,
 *    the polygon's ray casting with `level` (source-polygon.mjs:187, P2)
 *  - what blocks, what slows: `TokenLayer5e#isOccupiedGridSpaceBlocking` / `…Difficult`
 *    (dnd5e canvas/layers/tokens.mjs:10 and :62) — ally passable, enemy blocking, sizes,
 *    Halfling Nimbleness; judged by the cell's elevation slice `k` (tokens.mjs:112-133), so
 *    per level if one passes the `k` of the level's base elevation. The engine does not redo these rules
 *  - cost ceiling: the `maxCost` + `history` option of `constrainMovementPath` cuts a path
 *    to what the turn still allows, terrain included (token.mjs:3345)
 *  - preview: the token's ruler draws `token._plannedMovement[userId]` (token.mjs:174, :2016),
 *    with dnd5e's speed colors (canvas/ruler.mjs:82). Public field but poorly documented:
 *    risk noted in SPEC §12
 *  - `TokenDocument#move` only resolves at the end of the movement (documents/token.mjs:667)
 *
 * Levels (P2, §14.2): an A* cell carries its `level`. A staircase or ladder is a region
 * with a `changeLevel` behavior (client/data/region-behaviors/change-level.mjs): its `levels` say
 * which levels it connects (empty = all), its elevation slice must contain the base elevation of the
 * two, `movementActions` (`climb` for a ladder) gives the cost multiplier. One never ENTERS
 * a staircase by walking: the core's behavior opens its dialog on entering its region
 * (event emitted during movement, seen in play on 2026-09-23: movement paused). The
 * segment stops on a neighboring cell, and a single `displace` step — with `level` and `elevation` = base
 * of the arrival level — puts the token on the other level's staircase: a `displace` does not trigger
 * the dialog (change-level.mjs:62) and a teleportation segment is not constrained by walls
 * (placeables/token.mjs, constrainMovementPath: "unless teleporting"). The core does not record the
 * cost of a `displace`: the cell and height crossed are counted by the engine (`climbed` budget,
 * adapter/turn.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { findPath, turningPoints } from "../core/pathfind.mjs";
import { approach, pushDirection, footprintGap, ownsPlannedMovement } from "../core/movement.mjs";
import { committedPosition, combatantFor, readBudget, writeBudget } from "./turn.mjs";
import { isIntangible } from "./pilot.mjs";
import { hasLineOfSight } from "./vision.mjs";
import { effectiveMode } from "./altitude.mjs";
import { lengthIn } from "./units.mjs";
import { worldFor } from "./path-world.mjs";
export { passableDoor, stairsDestinations, stairsEntry, stairsOf } from "./path-world.mjs";

export const cellKey = c => `${c.i},${c.j}`;

/** Size of a token in whole cells. */
export function sizeOf(token) {
  return { w: Math.max(1, Math.ceil(token._source.width ?? 1)), h: Math.max(1, Math.ceil(token._source.height ?? 1)) };
}

/** Top-left corner cell of a token, at its validated position (or at `pos`). */
export function cellOf(token, pos=committedPosition(token)) {
  const grid = token.parent.grid;
  return grid.getOffset({ x: pos.x + (grid.sizeX / 2), y: pos.y + (grid.sizeY / 2) });
}

/** Emprise d'un token, en cases. */
export function footprintOf(token) {
  return { ...cellOf(token), ...sizeOf(token) };
}

/** The cell under a scene point, to place the top-left corner of a token of this size there. */
export function cellUnder(token, point) {
  const grid = token.parent.grid;
  const { w, h } = sizeOf(token);
  // A large token is centered on the targeted point.
  return grid.getOffset({ x: point.x - (((w - 1) * grid.sizeX) / 2), y: point.y - (((h - 1) * grid.sizeY) / 2) });
}

/**
 * §18.27: the core's ruler (cells colored by speed, dnd5e canvas/ruler.mjs) is only displayed during an engine movement
 * in combat; outside combat, the token walks without it.
 */
export const rulerShown = () => game.combat?.started === true;

/**
 * §246 (issue #20): the options of an engine walk — the ruler (`rulerShown`) and the core's automatic rotation. A
 * `token.move()` without a method is "api", which the core never rotates (documents/token.mjs:1741); only dragging and the
 * keyboard follow the "Token Auto-Rotation" setting (`core.tokenAutoRotate`, game.mjs:1421). An engine walk (A* path,
 * `api.approach`, fleeing, resuming a stopped drag) follows it like them; a teleportation, a fall or a `displace` step does not
 * take it. The core rotates the token per segment during the animation and keeps the last one's rotation (token.mjs:2461).
 * `movement`: the movement stopped at `preMoveToken` that is replayed (Opportunity Attacks, realignment, caltrops) — it keeps
 * its own rotation (a drag follows it, a teleportation does not).
 */
export const walkOptions = movement => ({ showRuler: rulerShown(),
  autoRotate: movement ? (movement.autoRotate === true) : (game.settings.get("core", "tokenAutoRotate") === true) });

export const isDefeated = token => token.actor?.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) === true;

/* -------------------------------------------- */
/*  Chemin                                      */
/* -------------------------------------------- */

/** Cost of a path measured by the core (terrain, diagonals), start included in the list. */
function costOf(object, path, preview) {
  const measurement = object.measureMovementPath(path, { preview });
  let total = 0;
  for ( let n = 1; n < measurement.waypoints.length; n++ ) total += measurement.waypoints[n].backward?.cost ?? 0;
  return total;
}

/**
 * Splits a path of cells (with level) into single-level segments: `[{ cells, change }]`,
 * `change` = arrival level of the change that closes the segment, or null for the last one.
 */
export function legsOf(cells) {
  const legs = [];
  let current = [cells[0]];
  for ( let n = 1; n < cells.length; n++ ) {
    if ( cells[n].level !== cells[n - 1].level ) {
      legs.push({ cells: current, change: cells[n].level });
      current = [cells[n]];
    }
    else current.push(cells[n]);
  }
  legs.push({ cells: current, change: null });
  return legs;
}

/**
 * Looks for a path. `to`: either an arrival cell (on the displayed level, or `to.level`), or a
 * target to approach (on its level). Staircases connect levels (see top of file).
 * @param {TokenDocument} token
 * @param {{cell?: {i,j}, cells?: {i,j}[], level?: string, target?: TokenDocument, reachCells?: number, seeing?: boolean}} to
 * @param {{maxCost?: number, throughDoors?: boolean}} [options]  Turn cost ceiling (history included), grid
 *   unit; §18.25: `throughDoors`, the path may go through a closed door (`passableDoor`) — it then stops in front of
 *   the first one, and `door` says which to open before re-planning.
 * @returns {{waypoints: object[], beyond: object[], arrives: boolean, door?: WallDocument}|null}
 *   `waypoints`: what can be walked (level changes are `displace` points with
 *   `level`); `beyond`: the rest of the path, out of budget; null: no path.
 */
export function planPath(token, to, { maxCost=Infinity, throughDoors=false }={}) {
  if ( !token.object || token.parent.grid.isGridless || !token.parent.grid.isSquare ) return null;
  const world = worldFor(token, { throughDoors });
  const start = { ...cellOf(token), level: world.ownLevel };
  let goal;
  if ( to.target ) {
    const targetLevel = to.target._source.level;
    const near = approach(footprintOf(to.target), sizeOf(token), Math.max(1, to.reachCells ?? 1));
    goal = { isGoal: cell => ((cell.level ?? world.ownLevel) === targetLevel) && near.isGoal(cell), heuristic: near.heuristic };
    // P1: only approach to a distance as far as a cell from which the target is SEEN (line of sight, `sight` walls, surfaces) —
    // issue #42: without the edges of darkness sources (the Darkness spell is not a wall; seeing the target is `canSee`).
    if ( to.seeing ) {
      const grid = token.parent.grid;
      const { w, h } = sizeOf(token);
      const elevation = committedPosition(token).elevation;
      const within = goal.isGoal;
      goal.isGoal = cell => {
        if ( !within(cell) ) return false;
        const topLeft = grid.getTopLeftPoint(cell);
        const level = token.parent.levels?.get?.(cell.level ?? world.ownLevel);   // P2: the walls of that level
        return hasLineOfSight({ x: topLeft.x + (w * grid.sizeX) / 2, y: topLeft.y + (h * grid.sizeY) / 2, elevation }, to.target, level, { throughDarkness: true,
          externalRadius: Math.min(w * grid.sizeX, h * grid.sizeY) / 2 });   // §518: the window threshold, like the token's vision
      };
    }
  }
  else {
    // §18.24: several acceptable arrival cells (`to.cells`, the cells in contact with a door), the nearest wins.
    const level = to.level ?? canvas.level?.id ?? world.ownLevel;
    goal = { goals: (to.cells ?? [to.cell]).map(({ i, j }) => ({ i, j, level })) };
  }
  const found = findPath({ start, ...goal, canStep: world.canStep, canEnd: world.canEnd, stepCost: world.stepCost, transitions: world.transitions });
  if ( !found ) return null;
  let cells = found.path;
  // §18.25: the path passes a closed door — we stop in front of the first one.
  let door = null;
  for ( let n = 1; n < cells.length; n++ ) {
    door = world.doorBetween(cells[n - 1], cells[n]);
    if ( door ) { cells = cells.slice(0, n); break; }
  }
  const withDoor = plan => (door ? { ...plan, door } : plan);
  if ( cells.length === 1 ) return withDoor({ waypoints: [], beyond: [], arrives: true });

  // Segment by segment: the core measures the true cost (diagonals, region terrain) and cuts at the
  // budget; the height of a staircase is paid between two segments.
  const object = token.object;
  const preview = !game.user.isGM;
  // Turns only, but each carries the aligned cells before it where one can stop (`stops`), and `through` if it
  // is itself on an occupied cell: the walk is interrupted cell by cell (`walk`), never on someone else's.
  const toWaypoints = list => {
    const kept = new Set(turningPoints(list));
    const out = [];
    let stops = [];
    for ( const cell of list.slice(1) ) {
      const free = world.canEnd(cell);
      if ( !kept.has(cell) ) { if ( free ) stops.push(world.waypoint(cell)); continue; }
      out.push({ ...world.waypoint(cell), ...(stops.length ? { stops } : {}), ...(free ? {} : { through: true }) });
      stops = [];
    }
    return out;
  };
  const waypoints = [];
  const beyond = [];
  let remaining = maxCost;
  let origin = { ...committedPosition(token) };
  let cut = false;
  const legs = legsOf(cells);
  for ( const [index, leg] of legs.entries() ) {
    const full = [origin, ...leg.cells.slice(1).map(world.waypoint)];
    let kept = cut ? 1 : full.length;   // after the cut, everything else is out of budget
    if ( !cut && Number.isFinite(remaining) && (full.length > 1) ) {
      const terrain = object.createTerrainMovementPath(full, { preview });
      const [path] = object.constrainMovementPath(terrain, { maxCost: remaining, history: true, preview, ...(world.intangible ? { ignoreTokens: true } : {}) });
      // The core adds terrain points: we recount OUR reached cells, by position. Within a few pixels: when the budget
      // falls exactly on a cell (§192, seen on 2026-10-17: 20 ft spent, a climbing step of 10 ft, ceiling of 30), the core's
      // floating-point rounding cuts the step one pixel before the cell (y = 201 for 200) — the cell is reached, within 0.05 ft.
      const tolerance = Math.max(2, token.parent.grid.size * 0.02);
      const reached = point => path.some(p => (Math.abs(p.x - point.x) <= tolerance) && (Math.abs(p.y - point.y) <= tolerance));
      kept = 1;
      while ( (kept < full.length) && reached(full[kept]) ) kept++;
      // We do not stop on an occupied cell: back up to a free cell.
      while ( (kept > 1) && (kept < full.length) && !world.canEnd(leg.cells[kept - 1]) ) kept--;
      if ( kept < full.length ) cut = true;
      else remaining -= costOf(object, full, preview);
    }
    if ( cut ) {
      if ( kept > 1 ) waypoints.push(...toWaypoints(leg.cells.slice(0, kept)));
      beyond.push(...leg.cells.slice(kept).map(world.waypoint));
    }
    else waypoints.push(...toWaypoints(leg.cells));
    if ( leg.change ) {
      // The teleportation step: from the segment's last cell (next to the staircase) to the first of the
      // next one (the staircase, on the other level).
      const last = leg.cells.at(-1);
      const next = legs[index + 1].cells[0];
      // `climbCost` is in cells, the budget in grid units: we compare the step's height, already converted (seen on
      // 2026-09-27 by the `escaliers` scenario: a 25 ft staircase passed with a 24 ft budget, and only deducted 5 from it).
      const change = world.change(next, world.climbCost(last, next));
      const climb = change.climb;
      if ( !cut && Number.isFinite(remaining) && (remaining - climb < -1e-6) ) cut = true;   // the staircase is over budget
      if ( cut ) beyond.push(change);
      else { waypoints.push(change); remaining -= climb; }
      origin = { ...committedPosition(token), x: change.x, y: change.y, elevation: change.elevation, level: change.level };
    }
  }
  return withDoor({ waypoints, beyond, arrives: !cut });
}

/* -------------------------------------------- */
/*  Preview                                     */
/* -------------------------------------------- */

/** The preview the engine placed on each token: the `_plannedMovement` entry that is its own. */
const shown = new WeakMap();

/**
 * Draws the planned path with the token's native ruler. `plan` null: clears.
 * `_plannedMovement[userId]` is also the entry of the core's drag (Token#_initializeDragLeft), where a pathfinding module
 * puts its route (`findMovementPath`): the preview only clears and replaces its own. Hovering is deferred (throttled);
 * its last call sometimes lands after a drag has begun, and used to clear the path the core had just planned.
 */
export function previewPath(token, plan) {
  const object = token.object;
  if ( !object ) return;
  const mine = game.user.id;
  const current = object._plannedMovement[mine];
  if ( !ownsPlannedMovement(current, shown.get(object)) ) return;
  if ( !plan || !(plan.waypoints.length || plan.beyond.length) ) {
    shown.delete(object);
    if ( !current ) return;
    delete object._plannedMovement[mine];
    object.renderFlags.set({ refreshRuler: true, refreshState: true });
    return;
  }
  const preview = true;
  const origin = { ...committedPosition(token) };
  const clean = list => list.map(({ climb, stops, through, ...w }) => w);
  const complete = list => token.getCompleteMovementPath(object.createTerrainMovementPath(list, { preview }));
  const foundPath = complete([origin, ...clean(plan.waypoints)]);
  const unreachableWaypoints = plan.beyond.length ? complete([foundPath.at(-1), ...clean(plan.beyond)]).slice(1) : [];
  const history = token.movementHistory;
  const combined = [...history, ...foundPath, ...unreachableWaypoints];
  const measurement = object.measureMovementPath(combined, { preview });
  for ( let n = history.length; n < combined.length; n++ ) combined[n].cost = measurement.waypoints[n].backward?.cost ?? 0;
  Object.assign(foundPath[0], { terrain: null, snapped: false, explicit: false, checkpoint: true, cost: 0,
    action: history.at(-1)?.action ?? foundPath[0].action });
  object._plannedMovement[mine] = { foundPath, unreachableWaypoints, history, hidden: true, searching: false };
  shown.set(object, object._plannedMovement[mine]);
  object.renderFlags.set({ refreshRuler: true, refreshState: true });
}

/* -------------------------------------------- */
/*  Execution                                   */
/* -------------------------------------------- */

/** The segments of a plan: each level change (`displace` with `level`) closes a `move`. */
function movesOf(waypoints) {
  const moves = [];
  let current = [];
  for ( const w of waypoints ) {
    current.push(w);
    if ( (w.action === "displace") && w.level ) { moves.push(current); current = []; }
  }
  if ( current.length ) moves.push(current);
  return moves;
}

/** Records the height crossed in the turn's budget (the core does not record the cost of a `displace`). */
async function chargeClimb(token, climb) {
  if ( !(climb > 0) ) return;
  const combatant = combatantFor(token.actor);
  if ( !combatant ) return;
  const budget = readBudget(combatant);
  await writeBudget(combatant, { ...budget, climbed: (Number(budget.climbed) || 0) + climb });
}

/**
 * A segment's points for the core: each cell where one can stop (`stops`, and the turns that are not `through`,
 * see `planPath`) becomes a control point (`checkpoint`). The core cuts the movement at the first (`#splitMovementPath`,
 * documents/token.mjs:2566), animates that piece and chains the next on its own a little before the animation ends ("pending"
 * movement, canvas/placeables/token.mjs:4331); `stopMovement` cuts what remains. The intermediate cells are not
 * explicit: the ruler does not mark them as steps.
 * `stoppable` false: the path in one piece, without a control point — for follow steps (`follow`), which no click
 * stops. A `Scene#view` that changes level redraws the whole canvas (documents/scene.mjs:273-281); a movement that
 * the core is still chaining at that moment refreshes a destroyed token ("Cannot read properties of null (reading 'position')",
 * `Token#_refreshPosition`). The follower walks precisely when the GM's view follows its leader upstairs (scenario `suivre`).
 */
function checkpointed(move, stoppable=true) {
  if ( !stoppable ) return move.map(({ climb, stops, through, ...w }) => w);
  const out = [];
  for ( const [index, { climb, stops, through, ...w }] of move.entries() ) {
    for ( const stop of stops ?? [] ) out.push({ ...stop, ...(w.action ? { action: w.action } : {}), explicit: false, checkpoint: true });
    out.push((through || (index === move.length - 1)) ? w : { ...w, checkpoint: true });
  }
  return out;
}

/**
 * The walks in progress on this client, per token (SPEC §99): a new click elsewhere or the pause stops them, and the
 * pieces the core chains keep the engine's options (`continuedFlags`).
 * @type {Map<TokenDocument, {stopped: boolean, flags: object}>}
 */
const walks = new Map();

/**
 * Stops this token's walk at the next control point (the free cell the current animation is leading it to). Returns true
 * if it was walking. Only the client that started a movement can stop it (`stopMovement`, documents/token.mjs:762):
 * that is the walk's.
 */
export function stopWalking(token) {
  const state = walks.get(token);
  if ( !state ) return false;
  state.stopped = true;
  if ( token.movement?.user?.isSelf && ["pending", "paused"].includes(token.movement.state) ) {
    try { token.stopMovement(); }
    catch(err) { console.warn(`${MODULE_ID} | stopping the movement of ${token.name}`, err); }
  }
  return true;
}

/** §102: stops all engine walks started by this client (each token, at the next control point); returns nothing. */
export function stopAllWalks() {
  for ( const token of Array.from(walks.keys()) ) stopWalking(token);
}

/**
 * B12: with the canvas torn down (scene change), a walk in progress will never finish — the core's `move` stays pending.
 * We stop it and forget it, so that this token's next walk does not try to stop a dead movement.
 */
export function forgetAllWalks() {
  stopAllWalks();
  walks.clear();
}

/**
 * B12: this client's movements left pending when the canvas is redrawn. The core chains a movement after the
 * previous one's animation (`#continueMovement`, documents/token.mjs:998); an update already sent at teardown
 * relaunches one, whose animation no longer exists: it stays "pending" forever and cuts the next walk after one cell
 * (seen on 2026-10-16). The brand-new canvas animates none: we stop them. `movingTokens`: documents/user.mjs:64.
 */
export function stopDeadMovements() {
  for ( const token of Array.from(game.user.movingTokens ?? []) ) {
    if ( token.movement?.state !== "pending" ) continue;
    try { token.stopMovement(); }
    catch(err) { console.warn(`${MODULE_ID} | stopping the movement of ${token.name}`, err); }
  }
}

/**
 * The engine's options for a piece of walk that the core chains itself: its update only takes the standard options
 * (`updateOptions`, documents/token.mjs:1036), not `[MODULE_ID]` (`cleared`, `follow`…). They are found through the
 * walk in progress when the movement follows another (`chain` non-empty). `movement`: that of `preMoveToken`, or
 * `options._movement[token.id]` of an `updateToken`. null outside an engine walk.
 */
export function continuedFlags(token, movement) {
  if ( !movement?.chain?.length ) return null;
  return walks.get(token)?.flags ?? null;
}

/**
 * Walks the path and only resolves once the token has arrived (animation included): rolls
 * come after the movement. A level change closes a `move` and opens another.
 * @returns {Promise<boolean>}  false if the movement was refused or interrupted.
 */
export async function walk(token, plan, flags={}) {
  previewPath(token, null);
  if ( !plan.waypoints.length ) return true;
  // Like the core's drag (canvas/placeables/token.mjs:1106): a player does not move during the pause.
  if ( game.paused && !game.user.isGM ) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return false;
  }
  stopWalking(token);
  const options = { [MODULE_ID]: { planned: true, ...flags } };
  const state = { stopped: false, flags: options[MODULE_ID] };
  walks.set(token, state);
  try { return await walkMoves(token, plan, options, state); }
  finally { if ( walks.get(token) === state ) walks.delete(token); }
}

async function walkMoves(token, plan, options, state) {
  // §17.4: the path was planned in the token's real mode (a flying creature left in walking mode): we give it that.
  const mode = effectiveMode(token);
  if ( mode !== token.movementAction ) await token.update({ movementAction: mode }, { [MODULE_ID]: { altitude: true } });
  for ( const move of movesOf(plan.waypoints) ) {
    if ( state.stopped ) return false;
    const change = (move.at(-1).action === "displace") && move.at(-1).level ? move.at(-1) : null;
    const from = token._source.level;
    // §16.15: an object that does not occupy its space (Bigby's Hand) passes through creatures — `ignoreTokens` option that
    // dnd5e reads in the constraint options (canvas/token.mjs:88), passed by the core (documents/token.mjs:1723).
    // §219: `overWalls` — jumping from the edge of an open-air roof to a lower level, over the "guard-rail" wall that borders
    // that edge.
    const constrainOptions = (isIntangible(token) || options[MODULE_ID].overWalls)
      ? { ...(isIntangible(token) ? { ignoreTokens: true } : {}), ...(options[MODULE_ID].overWalls ? { ignoreWalls: true } : {}) } : undefined;
    const done = await token.move(checkpointed(move, !options[MODULE_ID].follow), { ...walkOptions(), ...(constrainOptions ? { constrainOptions } : {}), ...options });
    // In a hidden tab the animation never ends: we do not wait indefinitely. A `displace` step that changes level (staircase) has
    // nothing to wait for: teleported to a level the view does not display yet, the token never finishes its animation and every
    // staircase cost the 10 s of the safety net (seen on 2026-09-29: 22 to 24 s round trip in the `escaliers` scenario, §38.8).
    // A stopped walk too: we wait until the token has finished going to the control point where the core left it.
    const animation = change && !state.stopped ? null : token.object?.movementAnimationPromise;
    if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, 10000))]);
    if ( state.stopped || (done === false) ) return false;
    if ( change ) {
      if ( token._source.level !== change.level ) return false;   // the core did not change level: we do not insist
      await chargeClimb(token, change.climb);
      // Like the core's behavior (change-level.mjs:110): a GM's view follows their token upstairs.
      if ( game.user.isGM && token.parent.isView && (canvas.level?.id === from) ) {
        await token.parent.view({ level: change.level, controlledTokens: [token.id] });
      }
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  Push                                        */
/* -------------------------------------------- */

/**
 * Pushes `target` away from `source` (Shove, SPEC §15.2): in a straight line, cell by cell, as long as
 * nothing stops it — a wall (`canStep`, seen from the pushed creature, in its level), a creature, a staircase; it does not
 * stop on an occupied cell (`canEnd`). A single `displace` step: a push is suffered, it does not
 * provoke an Opportunity Attack and costs the pushed creature nothing; `cleared` makes it pass without an
 * engine check (runtime/actions.mjs). Active GM only.
 * `towards` (Thorn Whip, "you pull it 3 m toward you"): the same thing toward the source, stopping
 * in front of it — its cell is occupied, `canEnd` knows it.
 * @param {TokenDocument} source
 * @param {TokenDocument} target
 * @param {{distance: number, units: string}} push
 * @param {object} factors  Unit conversion factors (adapter/units.mjs).
 * §497: `direction` ({ di, dj }) imposes the direction (random movement); `whole`: all or nothing, the target stays in place if
 * the whole distance is not free.
 * @param {{towards?: boolean, follow?: boolean, point?: object, direction?: {di: number, dj: number}, whole?: boolean}} [options]
 * @returns {Promise<{cells: number, wanted: number, blocked?: boolean}>}  Cells walked, cells wanted; `blocked`: none walked.
 */
export async function pushAway(source, target, { distance, units }, factors, { towards=false, follow=false, point=null, direction=null, whole=false }={}) {
  const grid = target.parent.grid;
  let value = lengthIn(distance, units, grid.units, factors);
  const wanted = Math.max(1, Math.round((value / grid.distance) + 1e-6));
  if ( !target.object || grid.isGridless || !grid.isSquare ) return { cells: 0, wanted };

  const centerOf = doc => {
    const pos = committedPosition(doc);
    const { w, h } = sizeOf(doc);
    return { x: pos.x + ((w * grid.sizeX) / 2), y: pos.y + ((h * grid.sizeY) / 2) };
  };
  // §466: `point` — toward (or away from) this point rather than the author: the center of an area (Implosion).
  // §497: `direction` ({ di, dj }) — an imposed direction (rolled on a die: Infestation), neither toward nor away from the source.
  const away = direction ? { di: direction.di, dj: direction.dj } : pushDirection(point ?? centerOf(source), centerOf(target));
  const dir = away && towards && !direction ? { di: -away.di, dj: -away.dj } : away;
  if ( !dir ) return { cells: 0, wanted };
  const world = worldFor(target);
  let cell = { ...cellOf(target), level: world.ownLevel };
  let cells = 0;
  // §403: pulled toward the source, the creature stops at its contact — the source may not occupy its space (Grasping Vine),
  // nothing stopped it then: it passed through and ended up on the other side.
  const from = (towards && !point) ? footprintOf(source) : null;
  // §466: pulled toward a point, the creature stops when its space covers it.
  const at = point ? grid.getOffset(point) : null;
  const size = sizeOf(target);
  // The step's direction, from the center of the space (corner `c`, size `sz`) toward the point.
  const stepToward = (c, sz, p) => {
    const origin = grid.getTopLeftPoint(c);
    const d = pushDirection({ x: origin.x + ((sz.w * grid.sizeX) / 2), y: origin.y + ((sz.h * grid.sizeY) / 2) }, p);
    return d ? { di: d.di, dj: d.dj } : null;
  };
  for ( ; cells < wanted; cells++ ) {
    if ( from && (footprintGap({ i: cell.i, j: cell.j, ...size }, from) <= 1) ) break;
    if ( at && towards && (footprintGap({ i: cell.i, j: cell.j, ...size }, { i: at.i, j: at.j, w: 1, h: 1 }) === 0) ) break;
    // §502: pulled toward a point, the direction is recomputed at each step (a direction rounded once and for all missed the
    // point without ever covering it, and the creature ended up farther than at the start — bench of 2026-11-20, Grasping Vine).
    const step = (point && towards && !direction) ? (stepToward(cell, size, point) ?? dir) : dir;
    const next = { i: cell.i + step.di, j: cell.j + step.dj, level: cell.level };
    if ( !world.canStep(cell, next) || !world.canEnd(next) ) break;
    cell = next;
  }
  // §497: `whole` — all or nothing ("the creature does not move if the space is occupied").
  if ( whole && (cells < wanted) ) return { cells: 0, wanted, blocked: true };
  if ( !cells ) return { cells, wanted, blocked: wanted > 0 };
  const landing = grid.getTopLeftPoint(cell);
  await target.move([{ x: landing.x, y: landing.y, snapped: true, action: "displace" }], { [MODULE_ID]: { cleared: true } });
  // "The hand moves with the target, staying 1.50 m from it" (Forceful Hand, §16.15): same offset.
  if ( follow && source.object ) {
    const from = committedPosition(source);
    await source.move([{ x: from.x + (cells * dir.dj * grid.sizeX), y: from.y + (cells * dir.di * grid.sizeY), snapped: true, action: "displace" }],
      { ...(isIntangible(source) ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { cleared: true } });
  }
  return { cells, wanted };
}

/* -------------------------------------------- */
/*  Dragged by a grappler                       */
/* -------------------------------------------- */

/**
 * Where to place a victim dragged by its grappler (Grappled, "Movable"): where the relative position
 * would want it (`desired`, top-left corner) if the cell is free; otherwise the free cell in contact with
 * the grappler closest to that wish. Never inside another creature (`canEnd`). null: nowhere.
 * @param {TokenDocument} victim
 * @param {TokenDocument} grappler   At its arrival position.
 * @param {{x: number, y: number}} desired
 * @returns {{x: number, y: number}|null}
 */
export function dragDestination(victim, grappler, desired) {
  const grid = victim.parent.grid;
  if ( grid.isGridless || !grid.isSquare ) return null;
  const world = worldFor(victim);
  const level = committedPosition(grappler).level ?? world.ownLevel;
  const want = { ...grid.getOffset({ x: desired.x + (grid.sizeX / 2), y: desired.y + (grid.sizeY / 2) }), level };
  if ( world.canEnd(want) ) return grid.getTopLeftPoint(want);
  const g = footprintOf(grappler);
  const { w, h } = sizeOf(victim);
  const candidates = [];
  for ( let i = g.i - h; i <= g.i + g.h; i++ ) {
    for ( let j = g.j - w; j <= g.j + g.w; j++ ) {
      const cell = { i, j, level };
      if ( footprintGap({ i, j, w, h }, g) !== 1 ) continue;   // au contact (1) : ni dessus (0), ni plus loin
      candidates.push({ cell, d: Math.hypot(i - want.i, j - want.j) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const free = candidates.find(c => world.canEnd(c.cell));
  return free ? grid.getTopLeftPoint(free.cell) : null;
}
