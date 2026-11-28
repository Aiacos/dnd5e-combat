/**
 * The world the engine's A* sees (core/pathfind.mjs): levels and staircases (`changeLevel` regions), walls and doors, floor and
 * ceiling, Difficult Terrain, regions to avoid. Extracted from adapter/movement.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { cellDistance } from "../core/pathfind.mjs";
import { committedPosition, positionOf } from "./turn.mjs";
import { overlapsVertically } from "../core/space.mjs";
import { isIntangible } from "./pilot.mjs";
import { sharesSpaceWith, shareKindOf } from "./space-sharing.mjs";
import { placementOf, coherentElevation, groundStepAllowed } from "../core/altitude.mjs";
import { groundAt, ceilingAt, clearanceOf, effectiveMode } from "./altitude.mjs";
import { isOnCeiling, isClimbing, wallsNear } from "./climb.mjs";
import { climbSystemOn } from "../core/climb-system.mjs";
import { cellOf, footprintOf, isDefeated, cellKey, sizeOf } from "./movement.mjs";
import { isEthereal, etherealWallBetween } from "./plane.mjs";

/* -------------------------------------------- */
/*  Niveaux                                     */
/* -------------------------------------------- */

/** A scene level: base elevation and rank `k` of its vertical cell. null if unknown. */
function levelInfo(scene, id) {
  const level = scene.levels?.get?.(id);
  if ( !level ) return null;
  const base = level.elevation.base;
  return { id, level, base, k: Math.floor((base / scene.grid.distance) + 1e-8) };
}

/** Does a region elevation slice (prepared, ±Infinity) contain this elevation? */
const inRange = (region, elevation) => (elevation >= region.elevation.bottom) && (elevation <= region.elevation.top);

/** The movement actions that cost double without the matching speed (2024 rules: climbing, swimming, crawling). */
const DOUBLED_ACTIONS = { climb: "climb", swim: "swim", crawl: null };

/**
 * What a movement action costs, as a multiple of the distance. dnd5e 6 replaces the core's
 * table (`CONFIG.Token.movement.actions`) with its own, without `costMultiplier` but with a
 * `getCostFunction`: we do not call it, we apply the rule — climbing, swimming, crawling cost
 * double, except with the matching speed on the sheet.
 */
function actionMultiplier(action, actor) {
  const config = CONFIG.Token.movement.actions[action];
  if ( Number.isFinite(config?.costMultiplier) ) return config.costMultiplier;
  if ( !(action in DOUBLED_ACTIONS) ) return 1;
  const speed = DOUBLED_ACTIONS[action];
  return (speed && ((actor?.system?.attributes?.movement?.speeds?.[speed] ?? actor?.system?.attributes?.movement?.[speed] ?? 0) > 0)) ? 1 : 2;
}

/**
 * The staircases and ladders of the scene: regions with an active `changeLevel` behavior, the levels
 * they connect and the cost multiplier of their action (ladder: `climb`, ×2 without a climb
 * speed; several actions allowed: the cheapest).
 * @param {Scene} scene
 * @param {Actor|null} [actor]  The one who moves, for their speeds.
 * @returns {{region: RegionDocument, levels: string[], multiplier: number}[]}
 */
export function stairsOf(scene, actor=null) {
  const out = [];
  for ( const region of scene.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type !== "changeLevel") || behavior.disabled ) continue;
      const levels = region.levels.size ? [...region.levels] : scene.levels.map(l => l.id);
      const actions = [...(behavior.system.movementActions ?? [])];
      out.push({ region, levels, multiplier: actions.length ? Math.min(...actions.map(a => actionMultiplier(a, actor))) : 1 });
    }
  }
  return out;
}

/**
 * §41.2: where the staircase (ladder, elevator) under this point leads, for this token — the levels connected by a `changeLevel`
 * region that contains the point, other than its own, from lowest to highest. Empty: not a staircase for it (other
 * displayed level, region outside its elevation slice, grid without cells). Same reading as the A* (`stairsAt`, `transitions`).
 * @param {TokenDocument} token
 * @param {{x: number, y: number}} point  Scene point (the mouse).
 * @returns {{id: string, name: string, direction: "up"|"down"|"level"}[]}
 */
export function stairsDestinations(token, point) {
  const scene = token.parent;
  const from = token._source.level;
  const here = levelInfo(scene, from);
  if ( !here || scene.grid.isGridless || !scene.grid.isSquare || ((canvas.level?.id ?? from) !== from) ) return [];
  const found = new Map();
  for ( const s of stairsOf(scene, token.actor) ) {
    if ( !s.levels.includes(from) || !inRange(s.region, here.base) || !s.region.polygonTree.testPoint(point, 0) ) continue;
    for ( const id of s.levels ) {
      const info = (id === from) ? null : levelInfo(scene, id);
      if ( !info || !inRange(s.region, info.base) || found.has(id) ) continue;
      found.set(id, { id, name: info.level.name, base: info.base,
        direction: (info.base > here.base) ? "up" : (info.base < here.base) ? "down" : "level" });
    }
  }
  return [...found.values()].sort((a, b) => a.base - b.base).map(({ id, name, direction }) => ({ id, name, direction }));
}

/**
 * §17.2: dnd5e's Difficult Terrain regions (`dnd5e.difficultTerrain`) that slow this token — same sorting as
 * the behavior (data/region-behavior/difficult-terrain.mjs, `_getTerrainEffects`: ignored dispositions, terrain
 * ignored by the actor, magical or not). The real cost is still measured by the core; this only serves to make it route around.
 */
export function difficultRegionsFor(token) {
  const ignored = token.actor?.system?.attributes?.movement?.ignoredDifficultTerrain ?? new Set();
  if ( ignored.has?.("all") ) return [];
  const out = [];
  for ( const region of token.parent.regions ) {
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type !== "dnd5e.difficultTerrain") || behavior.disabled ) continue;
      const s = behavior.system;
      if ( s.ignoredDispositions?.has?.(token.disposition) ) continue;
      if ( s.types?.size && ![...s.types].some(t => !ignored.has?.(t)) ) continue;
      if ( (ignored.has?.("magical") && s.magical) || (ignored.has?.("nonmagical") && !s.magical) ) continue;
      out.push(region);
      break;
    }
  }
  return out;
}

/**
 * §103: the regions a module asks the A* to avoid (`flags.dnd5e-combat.avoid`, Darsh Loot: a spotted trap) —
 * passable, but at such a cost that the path goes around them if it can; a destination inside remains possible.
 */
const AVOID_COST = 20;
function avoidRegionsFor(token) {
  return token.parent.regions.filter(r => r.getFlag(MODULE_ID, "avoid") === true);
}

/**
 * The world as the A* sees it, for a given token. Answers are cached: the world
 * only lives for the duration of one search.
 */
const SEARCH_RADIUS = 80;   // cells: beyond that, we do not search
// §209: at the wall, the path stays near the start — outside combat nothing bounded it, and a climber's A* went around a
// building along its walls (seen at Restored Keep: about fifty cells, door included, for a neighboring cell on the other
// side of the wall).
const CLIMB_RADIUS = 12;

/**
 * Issue #92: where can dnd5e find an occupant? `TokenLayer5e` searches the tokens quadtree for those whose rectangle
 * touches the cell, then only keeps those whose occupied cells (`TokenDocument#getOccupiedGridSpaceOffsets`, recorded position)
 * contain the requested cell. The rectangles are surveyed once (one pixel of margin); a token's occupied cells
 * are only computed if a cell touched by its rectangle is requested.
 * @param {TokenLayer} layer
 * @param {Token} self        The token that moves (dnd5e excludes it itself).
 * @param {SquareGrid} grid
 * @returns {((cell: {i: number, j: number}) => boolean)|null}  "another token may occupy this cell"; null: the
 *   layer cannot be read, we know nothing and ask dnd5e for everything.
 */
export function occupancyIndex(layer, self, grid) {
  const near = new Map();
  for ( const other of layer?.placeables ?? [] ) {
    if ( other === self ) continue;
    const b = other.bounds;
    if ( !b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) ) return null;
    const first = grid.getOffset({ x: b.x - 1, y: b.y - 1 });
    const last = grid.getOffset({ x: b.x + b.width + 1, y: b.y + b.height + 1 });
    for ( let i = first.i; i <= last.i; i++ ) for ( let j = first.j; j <= last.j; j++ ) {
      const key = cellKey({ i, j });
      if ( !near.has(key) ) near.set(key, []);
      near.get(key).push(other);
    }
  }
  const occupied = new Map();
  const occupies = (other, key) => {
    if ( !occupied.has(other) ) {
      let cells = null;   // null: this token cannot be read — dnd5e will answer
      try {
        const offsets = other.document.getOccupiedGridSpaceOffsets(other.document._source);
        cells = new Set(offsets.map(c => cellKey({ i: c.i, j: c.j })));
      }
      catch { cells = null; }
      occupied.set(other, cells);
    }
    const cells = occupied.get(other);
    return !cells || cells.has(key);
  };
  return cell => {
    const key = cellKey(cell);
    return (near.get(key) ?? []).some(other => occupies(other, key));
  };
}

/**
 * Issue #92: no edge (wall, source border) of the level in a step's rectangle — the core's collision test would
 * find nothing there. Two pixels of margin (the core rounds the origin and the arrival). The scene's borders are not in the
 * edges quadtree: the step must fit entirely inside the scene rectangle (a step that leaves or enters it
 * hits them). Without the edges quadtree: false.
 * @param {CanvasEdges|null} edges   The level's edges (`Level#edges`).
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {PIXI.Rectangle} within    The scene's rectangle (`canvas.dimensions.sceneRect`).
 */
export function noEdgeBetween(edges, from, to, within) {
  if ( typeof edges?.getEdges !== "function" ) return false;
  if ( !within?.contains(from.x, from.y) || !within.contains(to.x, to.y) ) return false;
  const x = Math.min(from.x, to.x) - 2;
  const y = Math.min(from.y, to.y) - 2;
  try {
    const rect = new PIXI.Rectangle(x, y, Math.abs(from.x - to.x) + 4, Math.abs(from.y - to.y) + 4);
    return edges.getEdges(rect, { includeInnerBounds: false, includeOuterBounds: false }).size === 0;
  } catch { return false; }
}

/**
 * §18.25: a door the path can cross by opening it — closed, unlocked, and for a player neither secret (they
 * cannot see it) nor outside their "WALL_DOORS" right nor paused (door-control.mjs, `_onMouseDown`). The wall (placeable) or
 * its document: in V14 a wall's edge carries the DOCUMENT (`Edge#object`, client/documents/wall.mjs:164-166).
 */
export function passableDoor(wall) {
  const doc = wall?.document ?? wall;
  if ( !doc?.isDoor || (doc.ds !== CONST.WALL_DOOR_STATES.CLOSED) ) return false;
  if ( game.user.isGM ) return true;
  return (doc.door !== CONST.WALL_DOOR_TYPES.SECRET) && game.user.can("WALL_DOORS") && !game.paused;
}

export function worldFor(token, { throughDoors=false }={}) {
  const scene = token.parent;
  const grid = scene.grid;
  const object = token.object;
  const { w, h } = sizeOf(token);
  const rect = canvas.dimensions.sceneRect;
  const ownLevel = token._source.level;
  const ownElevation = token._source.elevation ?? 0;
  const ownK = Math.floor((ownElevation / grid.distance) + 1e-8);
  const depth = committedPosition(token).depth ?? 1;
  const preview = !game.user.isGM;
  const start = cellOf(token);
  const levels = new Map();
  const infoOf = id => {
    if ( !levels.has(id) ) levels.set(id, levelInfo(scene, id));
    return levels.get(id);
  };
  const isOwn = cell => (cell.level ?? ownLevel) === ownLevel;
  const kOf = cell => isOwn(cell) ? ownK : (infoOf(cell.level)?.k ?? ownK);
  const elevationOf = cell => isOwn(cell) ? ownElevation : (infoOf(cell.level)?.base ?? ownElevation);

  const center = cell => {
    const tl = grid.getTopLeftPoint(cell);
    return { x: tl.x + ((w * grid.sizeX) / 2), y: tl.y + ((h * grid.sizeY) / 2) };
  };
  const cellsOf = cell => {
    const out = [];
    for ( let di = 0; di < h; di++ ) for ( let dj = 0; dj < w; dj++ ) out.push({ i: cell.i + di, j: cell.j + dj });
    return out;
  };

  // Cells where one cannot end: those of any other visible, standing token, on its level, except those that can be
  // shared (§105: Air Form, Swarm — adapter/space-sharing.mjs). An object that does not occupy its space (Bigby's
  // Hand, §16.15) bothers no one and is bothered by no one. §192: per cell, the vertical slices (feet-head) of the
  // tokens that occupy it — a climber above an occupied cell can stop there.
  const intangible = isIntangible(token);
  // Issue #92: who stands where is indexed first, from positions alone. Whether a token found there really takes its cells (hidden,
  // defeated, an object that does not occupy its space, sharing — which reads every item of both sheets —, visible to a previewing
  // player) is asked only when the search wants to end on one of its cells, once per token: on open ground no other sheet is read.
  // Same answers as asking for every token up front: this world lives for one synchronous search.
  const standing = new Map();
  if ( !intangible ) for ( const other of scene.tokens ) {
    if ( other === token ) continue;
    const o = footprintOf(other);
    for ( let di = 0; di < o.h; di++ ) for ( let dj = 0; dj < o.w; dj++ ) {
      const key = `${cellKey({ i: o.i + di, j: o.j + dj })}@${other._source.level}`;
      if ( !standing.has(key) ) standing.set(key, []);
      standing.get(key).push(other);
    }
  }
  // What the mover can share does not depend on the other token: read once for the whole scene (all its items), when first needed.
  let moverKind;
  const slices = new Map();
  /** The vertical slice (feet to head) this other token takes, or null if it does not take its cells for the mover. */
  const sliceOf = other => {
    if ( !slices.has(other) ) {
      let slice = null;
      if ( !other.hidden && !isDefeated(other) && !isIntangible(other) ) {
        if ( moverKind === undefined ) moverKind = shareKindOf(token.actor);
        const shown = !(preview && other.object && !other.object.visible);   // do not reveal an invisible token
        if ( !sharesSpaceWith(token, other, { moverKind }) && shown ) slice = positionOf(other._source);
      }
      slices.set(other, slice);
    }
    return slices.get(other);
  };

  const layer = canvas.tokens;
  const backend = CONFIG.Canvas.polygonBackends.move;
  // Issue #92: on open ground, the fixed cost of a path was that of the questions asked to dnd5e for each cell
  // (`isOccupiedGridSpaceBlocking`, `isOccupiedGridSpaceDifficult`: a search in the tokens quadtree, then the hook).
  // Where no other token occupies the cell, dnd5e would find nobody and its answer boils down to its hook, called here with
  // the same empty set (another module can still add an occupant).
  const mayHold = occupancyIndex(layer, object, grid);
  const occupiedBlocking = (cell, k) => {
    const space = { ...cell, k };
    if ( !mayHold || mayHold(cell) ) return layer.isOccupiedGridSpaceBlocking?.(space, object, { preview }) === true;
    const found = new Set();
    Hooks.callAll("dnd5e.determineOccupiedGridSpaceBlocking", space, object, { preview }, found);
    return found.size > 0;
  };
  const occupiedDifficult = (cell, k) => {
    const space = { ...cell, k };
    if ( !mayHold || mayHold(cell) ) return layer.isOccupiedGridSpaceDifficult?.(space, object, { preview }) === true;
    const found = new Set();
    Hooks.callAll("dnd5e.determineOccupiedGridSpaceDifficult", space, object, { preview }, found);
    return found.size > 0;
  };
  const blockedCache = new Map();
  const blocked = cell => {
    if ( intangible ) return false;
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !blockedCache.has(id) ) {
      const k = kOf(cell);
      blockedCache.set(id, cellsOf(cell).some(c => occupiedBlocking(c, k)));
    }
    return blockedCache.get(id);
  };
  // §41.3: a token's collision test reads the walls of the DISPLAYED level (`config.level ??= canvas.level`,
  // geometry/shapes/source-polygon.mjs:187). A token walking on a level this client is not looking at — the follower
  // left downstairs when the GM's view followed the leader upstairs — is therefore judged on the walls of its own level, by the
  // polygon of that level, like a cell of another level; without opening a door (the door test is the token's).
  const ownViewed = (canvas.level?.id ?? ownLevel) === ownLevel;
  const ownEdges = scene.levels?.get?.(ownLevel)?.edges ?? null;
  // §225, batch 3: in the Ethereal Plane, only the walls that stop ethereal travel (Wall of Force, Forcecage) count.
  const ethereal = isEthereal(token);
  /** A wall between two neighboring cells? In the token's level by the token's test; elsewhere by the level's polygon. */
  const wallBetween = (from, to) => {
    const c = center(to);
    if ( ethereal ) return etherealWallBetween(scene, center(from), c, to.level ?? ownLevel);
    if ( isOwn(to) && ownViewed ) {
      // Issue #92: no edge of the level in the step's rectangle — nothing to hit, without building the core's polygon.
      if ( noEdgeBetween(ownEdges, center(from), c, rect) ) return false;
      if ( !object.checkCollision(c, { origin: center(from), type: "move", mode: "any" }) ) return false;
      return !(throughDoors && doorBetween(from, to));
    }
    const info = infoOf(to.level ?? ownLevel);
    if ( !info ) return true;
    const eye = elevationOf(to) + ((depth * grid.distance) / 2);
    const o = center(from);
    return backend.testCollision({ x: o.x, y: o.y, elevation: eye }, { x: c.x, y: c.y, elevation: eye }, { type: "move", mode: "any", level: info.level }) === true;
  };

  /**
   * §18.25: the closed door a step crosses, if that is all that stops it (in the token's level), otherwise null. The
   * core's collision points ("all" mode, clockwise-sweep.mjs `_testCollision`) carry the edges that make them, and
   * a wall edge carries its wall (`Edge#object`).
   */
  const doorCache = new Map();
  const doorBetween = (from, to) => {
    const id = `${cellKey(from)}>${cellKey(to)}`;
    if ( !doorCache.has(id) ) {
      let door = null;
      const hits = object.checkCollision(center(to), { origin: center(from), type: "move", mode: "all" }) ?? [];
      for ( const hit of hits ) {
        for ( const edge of hit.edges ?? [] ) {
          if ( !passableDoor(edge.object) ) { door = null; break; }
          door = edge.object?.document ?? edge.object;   // le WallDocument
        }
        if ( !door ) break;
      }
      doorCache.set(id, door);
    }
    return doorCache.get(id);
  };

  // Staircases and ladders. The core's `changeLevel` behavior opens its dialog as soon as a token ENTERS
  // its region by walking (entry event, emitted during movement, change-level.mjs:57):
  // so one never enters it by walking. The segment stops on a neighboring cell, and a single teleportation
  // step (`displace`, which triggers nothing, change-level.mjs:62) puts the token on the staircase,
  // already on the other level. This step costs the cell crossed plus the height (multiplied for a ladder).
  const stairs = stairsOf(scene, token.actor);
  const stairsCache = new Map();
  /** The staircases that contain this cell, on its level. */
  const stairsAt = cell => {
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !stairsCache.has(id) ) {
      const from = cell.level ?? ownLevel;
      const base = elevationOf(cell);
      const c = center(cell);
      stairsCache.set(id, stairs.filter(s => s.levels.includes(from) && inRange(s.region, base) && s.region.polygonTree.testPoint(c, 0.75)));
    }
    return stairsCache.get(id);
  };
  const inStairs = cell => stairsAt(cell).length > 0;

  // §17.4: the mode gives each point's elevation — on the ground, the cell's floor; flying, at least 5 ft above; burrowing,
  // at least 5 ft below. On the ground, a step of 5 ft at most: the A* neither climbs nor jumps into the void.
  // §224: climbing and falling system off — the path keeps the token's elevation (no followed floor, no limited step, no wall to
  // hold). §225, batch 3: the Ethereal "does not obey the laws of gravity" — like the system off, the path keeps the elevation.
  const free = !climbSystemOn() || ethereal;
  const mode = effectiveMode(token);
  const placement = free ? null : placementOf(mode);
  const clearance = clearanceOf(scene);
  const groundCache = new Map();
  const groundOf = cell => {
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !groundCache.has(id) ) groundCache.set(id, groundAt(scene, cell.level ?? ownLevel, center(cell)));
    return groundCache.get(id);
  };
  // Flying, feet under the level's ceiling, head included.
  const pointsOf = cell => {
    try { return [center(cell), ...token.getContainmentTestPoints({ ...token._source, ...grid.getTopLeftPoint(cell) })]; }
    catch { return [center(cell)]; }
  };
  const ceilingOf = cell => ceilingAt(scene, pointsOf(cell), groundOf(cell)) - (depth * grid.distance);
  // §192 batch 2: on the ceiling, one only walks under a ceiling at the same height (head against it) — no wall needed anymore.
  const onCeiling = !free && isOnCeiling(token);
  const ceilingHolds = cell => !onCeiling || (Math.abs(ceilingOf(cell) - ownElevation) < 1e-6);
  // §196 (batch 4): on the wall, one only walks along a wall to climb (or where the floor rises up to oneself) — otherwise a
  // climber at 10 ft moved away from the wall in mid-air (click, gamepad, `api.approach`). Cached per cell: `wallsNear`
  // queries the edges.
  const onWall = !free && !onCeiling && isClimbing(token) && (ownElevation > groundOf(start) + 1e-6);
  // §209: a door is not open at a climber's height (a level wall is solid from floor to ceiling, its opening is not) — at
  // 5 ft or more above the floor, a step crossing it is refused, open or closed.
  const doorAbove = onWall && ((ownElevation - groundOf(start)) >= grid.distance - 1e-6);
  const highDoorCache = new Map();
  const doorOnStep = (from, to) => {
    const id = `${cellKey(from)}>${cellKey(to)}`;
    if ( !highDoorCache.has(id) ) {
      const a = center(from);
      const b = center(to);
      const edges = scene.levels?.get?.(from.level ?? ownLevel)?.edges;
      let found = false;
      try {
        const rect = new PIXI.Rectangle(Math.min(a.x, b.x) - 1, Math.min(a.y, b.y) - 1, Math.abs(a.x - b.x) + 2, Math.abs(a.y - b.y) + 2);
        for ( const edge of edges?.getEdges?.(rect, { includeOuterBounds: false }) ?? [] ) {
          const wall = edge.object?.document ?? edge.object;
          if ( (edge.type !== "wall") || !wall || (wall.door === CONST.WALL_DOOR_TYPES.NONE) ) continue;
          if ( foundry.utils.lineSegmentIntersects(a, b, edge.a, edge.b) ) { found = true; break; }
        }
      } catch { found = false; }
      highDoorCache.set(id, found);
    }
    return highDoorCache.get(id);
  };
  const wallCache = new Map();
  const wallHolds = cell => {
    if ( !onWall || !isOwn(cell) ) return true;
    const key = cellKey(cell);
    if ( !wallCache.has(key) ) {
      const pos = { ...grid.getTopLeftPoint(cell), elevation: ownElevation, level: ownLevel };
      wallCache.set(key, (groundOf(cell) >= ownElevation - 1e-6) || (wallsNear(token, pos).length > 0));
    }
    return wallCache.get(key);
  };
  // §192: when climbing, each point gives its elevation (the climber's) and its action — without them, the cut at the turn's
  // budget (`constrainMovementPath`) measured the first step from the ground, and a climber could no longer walk along the
  // wall in combat.
  const altitude = cell => placement
    ? { elevation: coherentElevation(mode, elevationOf(cell), groundOf(cell), clearance, (placement === "air") ? ceilingOf(cell) : Infinity), action: mode }
    : (((mode === "climb") || free) ? { elevation: elevationOf(cell), ...((mode === "climb") ? { action: mode } : {}) } : {});
  const difficult = difficultRegionsFor(token);
  const difficultCache = new Map();
  const difficultAt = cell => {
    if ( !difficult.length ) return false;
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !difficultCache.has(id) ) {
      const base = elevationOf(cell);
      const c = center(cell);
      difficultCache.set(id, difficult.some(r => inRange(r, base) && r.polygonTree.testPoint(c, 0.75)));
    }
    return difficultCache.get(id);
  };
  const avoid = avoidRegionsFor(token);
  const avoidCache = new Map();
  const avoidAt = cell => {
    if ( !avoid.length ) return false;
    const id = `${cellKey(cell)}@${cell.level ?? ownLevel}`;
    if ( !avoidCache.has(id) ) {
      const base = elevationOf(cell);
      const c = center(cell);
      avoidCache.set(id, avoid.some(r => inRange(r, base) && r.polygonTree.testPoint(c, 0.75)));
    }
    return avoidCache.get(id);
  };
  const transitions = cell => {
    if ( !stairs.length ) return [];
    const from = cell.level ?? ownLevel;
    const base = elevationOf(cell);
    const out = [];
    // From the cell itself (one already stands on the staircase) or from a neighbor.
    const candidates = [{ cell, horizontal: 0 }];
    for ( const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] ) {
      candidates.push({ cell: { i: cell.i + di, j: cell.j + dj, level: from }, horizontal: (di && dj) ? 1.001 : 1 });
    }
    for ( const { cell: n, horizontal } of candidates ) {
      const here = stairsAt(n);
      if ( !here.length ) continue;
      if ( horizontal && (blocked(n) || wallBetween(cell, n)) ) continue;
      for ( const s of here ) for ( const id of s.levels ) {
        if ( id === from ) continue;
        const info = infoOf(id);
        if ( !info || !inRange(s.region, info.base) ) continue;
        const next = { i: n.i, j: n.j, level: id };
        if ( blocked(next) ) continue;
        out.push({ cell: next, cost: horizontal + ((Math.abs(info.base - base) / grid.distance) * s.multiplier) });
      }
    }
    return out;
  };

  return {
    ownLevel,
    intangible,
    canStep(from, to) {
      const c = center(to);
      if ( !rect.contains(c.x, c.y) || (cellDistance(start, to) > SEARCH_RADIUS) || blocked(to) ) return false;
      if ( inStairs(to) && !inStairs(from) ) return false;   // we do not enter a staircase by walking (see above)
      if ( (placement === "ground") && ((from.level ?? ownLevel) === (to.level ?? ownLevel)) && !groundStepAllowed(groundOf(from), groundOf(to), clearance) ) return false;
      if ( !ceilingHolds(to) || !wallHolds(to) ) return false;
      if ( onWall && (cellDistance(start, to) > CLIMB_RADIUS) ) return false;
      if ( doorAbove && doorOnStep(from, to) ) return false;
      return !wallBetween(from, to);
    },
    canEnd: cell => {
      if ( !standing.size ) return true;
      const level = cell.level ?? ownLevel;
      const occupants = [];
      for ( const c of cellsOf(cell) ) for ( const other of standing.get(`${cellKey(c)}@${level}`) ?? [] ) {
        const slice = sliceOf(other);
        if ( slice ) occupants.push(slice);
      }
      if ( !occupants.length ) return true;
      const mine = { elevation: altitude(cell).elevation ?? elevationOf(cell), depth };
      return !occupants.some(o => overlapsVertically(mine, o, grid.distance));
    },
    // Difficult Terrain: occupied cells (dnd5e) and regions; the two do not stack (canvas/token.mjs:73).
    inStairs: cell => inStairs(cell),
    /** A step from `from` to its neighbor `to` with no wall between the two (in the level of `to`). */
    wallFree: (from, to) => !wallBetween(from, to),
    doorBetween: (from, to) => (throughDoors && isOwn(to) && ownViewed ? doorBetween(from, to) : null),
    // A door to open costs one more cell to the A*: it is only preferred over the detour it avoids.
    stepCost: (from, to) => (throughDoors && isOwn(to) && ownViewed && doorBetween(from, to) ? 1 : 0)
      + ((difficultAt(to) || cellsOf(to).some(c => occupiedDifficult(c, kOf(to)))) ? 2 : 1)
      + (avoidAt(to) ? AVOID_COST : 0),
    transitions,
    waypoint: cell => ({ ...grid.getTopLeftPoint(cell), snapped: true, ...altitude(cell) }),
    /** The level-changing step: `displace` onto the staircase cell `cell` of level `cell.level`, at its base. */
    change: (cell, cost) => {
      const info = infoOf(cell.level);
      // Without the diagonal's hint (0.001, core/pathfind.mjs): a whole cost in cells, in grid units.
      return { ...grid.getTopLeftPoint(cell), snapped: true, elevation: info.base, level: cell.level, action: "displace", climb: Math.round(cost) * grid.distance };
    },
    /** Cost (in cells) of the transition from `from` to staircase cell `to` of another level. */
    climbCost: (from, to) => (transitions(from).find(t => (t.cell.i === to.i) && (t.cell.j === to.j) && (t.cell.level === to.level))?.cost ?? 0)
  };
}

/** Cells of a single staircase explored at most, around the clicked cell. */
const MAX_STAIRS_CELLS = 64;

/**
 * §18.26: is the clicked cell a staircase or ladder of the token's level (and of the displayed level)? Then we go there
 * BY WALKING so that the core opens its level-change dialog: the A* goes to a neighboring cell outside the
 * staircase (`around`), then a last step enters the staircase cell that touches it (`entries`, per neighboring cell).
 * The staircase is taken through ANY of its cells (those touching the clicked cell, step by step), and
 * only with no wall between the neighbor and it (seen on 2026-09-27 by the `escaliers` scenario on Restored Keep: the East
 * staircase is walled off except on one side, and its first cell has no open neighbor). null: not a staircase, the token already
 * stands on it, or no entry.
 */
export function stairsEntry(token, cell) {
  const grid = token.parent.grid;
  if ( !token.object || grid.isGridless || !grid.isSquare ) return null;
  const world = worldFor(token);
  const level = world.ownLevel;
  if ( (canvas.level?.id ?? level) !== level ) return null;
  if ( !world.inStairs({ ...cell, level }) || world.inStairs({ ...cellOf(token), level }) ) return null;
  const steps = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  // The staircase's cells, step by step from the clicked cell.
  const stairs = new Map([[cellKey(cell), { i: cell.i, j: cell.j, level }]]);
  const queue = [stairs.get(cellKey(cell))];
  while ( queue.length && (stairs.size < MAX_STAIRS_CELLS) ) {
    const here = queue.shift();
    for ( const [di, dj] of steps ) {
      const next = { i: here.i + di, j: here.j + dj, level };
      if ( stairs.has(cellKey(next)) || !world.inStairs(next) ) continue;
      stairs.set(cellKey(next), next);
      queue.push(next);
    }
  }
  const around = [];
  const entries = new Map();
  for ( const inside of stairs.values() ) {
    for ( const [di, dj] of steps ) {
      const next = { i: inside.i + di, j: inside.j + dj, level };
      if ( stairs.has(cellKey(next)) || world.inStairs(next) || entries.has(cellKey(next)) || !world.wallFree(next, inside) ) continue;
      around.push(next);
      entries.set(cellKey(next), { i: inside.i, j: inside.j });
    }
  }
  return around.length ? { level, around, entries } : null;
}
