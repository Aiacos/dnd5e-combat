/**
 * Climbing (SPEC §192, batches 1 to 3), read from Foundry: the walls a token touches, its climber state, its speeds, walking
 * on the ceiling (its ability, the ceiling above it), slippery surfaces and the monk's Acrobatic Movement (§195).
 *
 * Verified:
 *  - a level's edges are in `Level#edges` (client/documents/level.mjs:51, a `CanvasEdges`), queried by rectangle
 *    (`CanvasEdges#getEdges(rect, { includeOuterBounds })`, canvas/geometry/edges/edges.mjs:140); a wall edge carries its
 *    document (`Edge#object`, client/documents/wall.mjs:164-166), its endpoints `a` / `b` and its `move` restriction
 *    (edge.mjs:23-35);
 *  - core walls have no height (common/documents/wall.mjs): one climbs along the face, in the same room;
 *  - walls placed by a spell carry `flags.dnd5e-combat.zone` (adapter/walls.mjs:40);
 *    their region carries the item (`flags.dnd5e.item`).
 */

import { MODULE_ID } from "../constants.mjs";
import {
  segmentTouchesRect, isClimbableWall, climbSpeed, climbMultiplier, climbFallReason, grantsCeiling, ceilingPerch, acrobaticAllowed, ledgeRise, MAX_CLIMB_CELLS
} from "../core/climb.mjs";
import { identifierOf, contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { isConcentrationEffect } from "./concentration.mjs";
import { settingOr } from "./settings.mjs";
import { committedPosition, positionOf } from "./turn.mjs";
import { groundUnder, boundsUnder, speedsOf, levelAt } from "./altitude.mjs";

export const CLIMB_RULES_SETTING = "climbRules";
/** A wall drawn slightly off the cell's edge still counts (fraction of a cell). */
const WALL_TOLERANCE = 0.1;

/** The world's climbing rules: `2024` (no roll) or `house` (DC 15 each turn, fall on a failure). */
export function climbRules() {
  return settingOr(CLIMB_RULES_SETTING, "2024") === "house" ? "house" : "2024";
}

/** Is the token climbing (movement mode `climb`)? */
export const isClimbing = token => token?._source?.movementAction === "climb";

/** The engine's climb flag (`flags.dnd5e-combat.climb`: `from`, `checkedAt`, `ceiling`). */
export const CLIMB_FLAG = "climb";
/** The vertical mirror placed on the ceiling (`flags.dnd5e-combat.ceilingFlip`: `{ scaleY }`, the original scale). */
export const FLIP_FLAG = "ceilingFlip";

/** §192 lot 2 : le token marche-t-il au plafond (en escalade, drapeau `climb.ceiling`) ? */
export const isOnCeiling = token => isClimbing(token) && (token.getFlag?.(MODULE_ID, CLIMB_FLAG)?.ceiling === true);

/** The identifier of the spell that placed this wall, or null (an ordinary wall). */
function spellOfWall(wall) {
  const regionId = wall.getFlag?.(MODULE_ID, "zone");
  if ( !regionId ) return null;
  const region = wall.parent?.regions.get(regionId);
  const item = fromUuidSync(region?.getFlag("dnd5e", "item") ?? "", { strict: false });
  return item ? (identifierOf(item).id ?? "spell") : "spell";
}

/**
 * The walls the token touches at a position (its footprint, along its level) and that can be climbed: no open door, no wall
 * without movement restriction, no spell wall (except Wall of Stone).
 * @param {TokenDocument} token
 * @param {object} [pos]  Position (source or waypoint), otherwise the committed position.
 * @returns {WallDocument[]}
 */
export function wallsNear(token, pos=committedPosition(token)) {
  const scene = token?.parent;
  const grid = scene?.grid;
  if ( !grid ) return [];
  const level = scene.levels?.get?.(pos.level ?? token._source.level) ?? scene.initialLevel ?? null;
  const edges = level?.edges;
  if ( typeof edges?.getEdges !== "function" ) return [];
  const width = (pos.width ?? token._source.width ?? 1) * grid.sizeX;
  const height = (pos.height ?? token._source.height ?? 1) * grid.sizeY;
  const tolerance = grid.size * WALL_TOLERANCE;
  const rect = { x: pos.x, y: pos.y, width, height };
  const query = new PIXI.Rectangle(rect.x - tolerance, rect.y - tolerance, width + (2 * tolerance), height + (2 * tolerance));
  const out = [];
  let found;
  try { found = edges.getEdges(query, { includeOuterBounds: false }); }
  catch { return []; }
  for ( const edge of found ) {
    if ( edge.type !== "wall" ) continue;
    const wall = edge.object?.document ?? edge.object;
    if ( !wall?.documentName || out.includes(wall) ) continue;
    if ( !segmentTouchesRect(edge.a, edge.b, rect, tolerance) ) continue;
    const openDoor = (wall.door !== CONST.WALL_DOOR_TYPES.NONE) && (wall.ds === CONST.WALL_DOOR_STATES.OPEN);
    if ( !isClimbableWall({ move: edge.move !== CONST.WALL_MOVEMENT_TYPES.NONE, openDoor, spell: spellOfWall(wall) }) ) continue;
    out.push(wall);
  }
  return out;
}

/** The token's climb speed (`native`: a true climb speed, otherwise walking) and dnd5e's cost multiplier. */
export function climbingOf(token) {
  const speeds = speedsOf(token?.actor);
  return { ...climbSpeed(speeds), multiplier: climbMultiplier(speeds) };
}

/** Why this climber no longer holds to the wall, or null: Prone, Incapacitated, Grappled, no speed. */
export function climbFallReasonFor(token) {
  const actor = token?.actor;
  const statuses = actor?.statuses ?? new Set();
  return climbFallReason({
    prone: statuses.has("prone"), incapacitated: statuses.has("incapacitated"), grappled: statuses.has("grappled"),
    speed: climbSpeed(speedsOf(actor)).speed
  });
}

/** Is the token above its ground? */
export function aboveGround(token) {
  return (token._source.elevation ?? 0) > groundUnder(token) + 1e-6;
}

/* -------------------------------------------- */
/*  Plafonds (lot 2)                            */
/* -------------------------------------------- */

/**
 * Can the creature walk on the ceiling (§192.3)? By an item it carries — identifier `spider-climb` (monster trait, Ravenloft
 * Dhampir trait), `slippers-of-spider-climbing`, `cloak-of-arachnida` (equipped), or any `climbsCeilings` content entry
 * (open to neighbors) — or by an effect such an item placed (the SPELL Spider Climb: knowing it is not enough, as for
 * shared space, adapter/space-sharing.mjs). On a slippery surface (`slippery`, §195), not by the Slippers of Spider Climbing.
 * @param {Actor5e} actor
 * @param {{slippery?: boolean}} [options]
 */
export function canWalkCeilings(actor, { slippery=false }={}) {
  if ( !actor ) return false;
  const grants = item => grantsCeiling(identifierOf(item).id, contentOf(item).entry, { slippery });
  for ( const item of actor.items ?? [] ) {
    if ( item.type === "spell" ) continue;
    if ( (item.type === "equipment") && !item.system?.equipped ) continue;
    if ( grants(item) ) return true;
  }
  for ( const effect of actor.effects ?? [] ) {
    // §195: the caster's concentration also originates from the spell — it gives nothing (Spider Climb cast on an ally).
    if ( effect.disabled || effect.isSuppressed || isConcentrationEffect(effect) ) continue;
    const item = originItemOf(effect);
    if ( item && grants(item) ) return true;
  }
  return false;
}

/**
 * The elevation of the feet of a token hanging from the ceiling above a position (the lowest `move` Surface above its ground,
 * `ceilingAt`, minus its height), or null without a ceiling. `pos`: waypoint or arrival position, otherwise the
 * committed position.
 */
export function ceilingPerchFor(token, pos=committedPosition(token)) {
  const scene = token?.parent;
  if ( !scene?.grid ) return null;
  const { ceiling } = boundsUnder(token, pos);   // already: ceiling minus the token's height (head included)
  if ( !Number.isFinite(ceiling) ) return null;
  const depth = positionOf({ ...token._source, ...pos }).depth ?? 1;
  return ceilingPerch(ceiling + (depth * scene.grid.distance), depth, scene.grid.distance);
}

/** Would the token, at this position, be properly hung from the ceiling (feet at the height of the perch)? */
export function hangsAt(token, pos=committedPosition(token)) {
  const perch = ceilingPerchFor(token, pos);
  return (perch !== null) && (Math.abs((pos.elevation ?? token._source.elevation ?? 0) - perch) < 1e-6);
}

/* -------------------------------------------- */
/*  Contenu (lot 3, §195)                       */
/* -------------------------------------------- */

/** Is a region's area slippery (its item declares `slippery`: Grease, pool of Oil)? */
function isSlipperyRegion(region) {
  const uuid = region.getFlag?.("dnd5e", "item");
  if ( !uuid ) return false;
  const item = fromUuidSync(uuid, { strict: false });
  return contentOf(item).entry?.slippery === true;
}

/**
 * Does the token stand, at this position, on a slippery surface — in a Grease area or a pool of Oil (elevation included:
 * the area has its slice, one leaves it by going up)?
 * @param {TokenDocument} token
 * @param {object} [pos]
 */
export function inSlipperyZone(token, pos=committedPosition(token)) {
  for ( const region of token?.parent?.regions ?? [] ) {
    if ( !isSlipperyRegion(region) ) continue;
    try { if ( token.testInsideRegion(region, pos) ) return true; }
    catch { /* region without a shape */ }
  }
  return false;
}

/** Can the creature walk on the ceiling where this token stands (the Slippers do not hold on a slippery surface)? */
export const canWalkCeilingsAt = (token, pos=committedPosition(token)) => canWalkCeilings(token?.actor, { slippery: inSlipperyZone(token, pos) });

/** L'item de Mouvement acrobatique de l'acteur (contenu `climbsOnTurn`), ou null. */
export function acrobaticItemOf(actor) {
  return (actor?.items ?? []).find(i => contentOf(i).entry?.climbsOnTurn === true) ?? null;
}

/**
 * Can the token "run along the wall" now (Acrobatic Movement, §195): the item, without armor or shield, and in combat on its
 * own turn only (outside combat, always).
 */
export function acrobaticFor(token) {
  const actor = token?.actor;
  if ( !acrobaticItemOf(actor) ) return false;
  const ac = actor.system?.attributes?.ac ?? {};
  const combat = game.combat?.started ? game.combat : null;
  const inCombat = !!combat?.combatants.some(c => c.tokenId === token.id);
  return acrobaticAllowed({ armor: !!ac.equippedArmor, shield: !!ac.equippedShield, inCombat, ownTurn: combat?.combatant?.tokenId === token.id });
}

/* -------------------------------------------- */
/*  Se hisser (§209)                             */
/* -------------------------------------------- */

/**
 * §216: does a wall of level `level` separate these two cells at this height? (A story's outer wall between the climber outside
 * and the story's floor: one does not haul oneself up through it.) The core's movement test, center to center, on that
 * level; without a canvas, nothing blocks.
 */
export function crossingBlocked(token, from, to, level, elevation) {
  const scene = token?.parent;
  const grid = scene?.grid;
  const backend = CONFIG.Canvas?.polygonBackends?.move;
  if ( !grid || (typeof backend?.testCollision !== "function") || !canvas?.ready || (canvas.scene !== scene) ) return false;
  const w = (token._source.width ?? 1) * grid.sizeX / 2;
  const h = (token._source.height ?? 1) * grid.sizeY / 2;
  const doc = scene.levels?.get?.(level) ?? undefined;
  try {
    return backend.testCollision({ x: from.x + w, y: from.y + h, elevation }, { x: to.x + w, y: to.y + h, elevation },
      { type: "move", mode: "any", level: doc }) === true;
  } catch { return false; }
}

/** The four directions of a ledge, and their name (translation key `Escalade.Dir.*`). */
const LEDGE_DIRS = Object.freeze([{ di: -1, dj: 0, dir: "n" }, { di: 1, dj: 0, dir: "s" }, { di: 0, dj: 1, dir: "e" }, { di: 0, dj: -1, dir: "w" }]);

/**
 * §209: the ledges where this climber can haul itself up now — a neighboring cell (north, south, east, west) whose floor is
 * higher than its feet and within reach of its head, with room to stand there (`ledgeRise`). Wall only (not the ceiling).
 * Returns for each the cell, the arrival point, the ground, the height to climb and the level where it gets a foothold
 * (the floor at 20 ft of a level 0-20 is the bottom of the next).
 * @returns {{dir: string, x: number, y: number, ground: number, rise: number, level: string}[]}
 */
export function ledgesOf(token) {
  if ( !isClimbing(token) || isOnCeiling(token) ) return [];
  const scene = token.parent;
  const grid = scene?.grid;
  if ( !grid?.size ) return [];
  const pos = committedPosition(token);
  const feet = pos.elevation ?? 0;
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * grid.distance;
  const out = [];
  // A level's ground counts only its Surfaces of `[bas, haut[` (adapter/altitude.mjs, `groundAt`): a roof at 20 ft is not the
  // floor of level 0-20 (it is its ceiling), but of the level that starts at 20. So we look at the level of the climber
  // and that of its head.
  const own = pos.level ?? token._source.level;
  const levels = [...new Set([own, levelAt(scene, feet + height, own)])];
  // §216: the climber's head does not pass its own ceiling.
  const ownCeiling = boundsUnder(token, pos).ceiling + height;
  for ( const { di, dj, dir } of LEDGE_DIRS ) {
    let best = null;
    for ( const level of levels ) {
      const at = { ...pos, level, x: pos.x + (dj * grid.sizeX), y: pos.y + (di * grid.sizeY) };
      const { ground, ceiling } = boundsUnder(token, at);
      const rise = ledgeRise({ feet, height, ground, ceiling: ceiling + height });
      if ( (rise === null) || (best && (ground <= best.ground)) ) continue;
      // §216: neither through its own ceiling (a covered corridor: the head does not rise above), nor through the wall of a
      // covered room at the arrival level. An open-air roof stays accessible despite the wall that often borders
      // its edge (guardrail).
      if ( ground >= ownCeiling - 1e-6 ) continue;
      const arrival = levelAt(scene, ground, level);
      if ( Number.isFinite(ceiling) && crossingBlocked(token, pos, at, arrival, ground + 1) ) continue;
      best = { dir, x: at.x, y: at.y, ground, rise, level: arrival };
    }
    if ( best ) out.push(best);
  }
  return out;
}

/**
 * §215: the top of the wall this token faces, for the climb window's gauge — the lowest ledge on which to put the feet on a
 * neighboring cell (higher than its feet, within reach of its head under the ceiling; with the name of its level), otherwise the
 * ceiling (the Surface above its head), otherwise null; and `ceilingFeet`, the highest elevation of its feet.
 * On the ground as on the wall.
 * @returns {{top: {kind: "ledge"|"ceiling", at: number, name?: string|null}|null, ceilingFeet: number, height: number}}
 */
export function wallTopOf(token) {
  const scene = token?.parent;
  const grid = scene?.grid;
  const pos = committedPosition(token);
  const feet = pos.elevation ?? 0;
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * (grid?.distance ?? 5);
  const { ceiling } = boundsUnder(token, pos);
  const ceilingFeet = Number.isFinite(ceiling) ? ceiling : Infinity;
  if ( !grid?.size ) return { top: null, ceilingFeet, height };
  const own = pos.level ?? token._source.level;
  // The level of the climber and all those that start above its feet, under its ceiling (open-air: all) — the neighboring roof
  // may belong to any of them.
  const above = Array.from(scene.levels ?? []).filter(l => {
    const bottom = Number(l.elevation?.bottom);
    return Number.isFinite(bottom) && (bottom > feet + 1e-6) && (bottom < ceilingFeet + height - 1e-6);
  }).map(l => l.id);
  const levels = [...new Set([own, ...above])];
  let ledge = null;
  for ( const { di, dj } of LEDGE_DIRS ) {
    for ( const level of levels ) {
      const at = { ...pos, level, x: pos.x + (dj * grid.sizeX), y: pos.y + (di * grid.sizeY) };
      const { ground } = boundsUnder(token, at);
      if ( !Number.isFinite(ground) || (ground <= feet + 1e-6) || (ground >= ceilingFeet + height - 1e-6) ) continue;
      const arrival = levelAt(scene, ground, level);
      if ( Number.isFinite(boundsUnder(token, at).ceiling) && crossingBlocked(token, pos, at, arrival, ground + 1) ) continue;
      if ( !ledge || (ground < ledge.at) ) ledge = { kind: "ledge", at: ground, level: arrival };
    }
  }
  if ( ledge ) {
    ledge.name = scene.levels?.get?.(ledge.level)?.name ?? null;
    return { top: ledge, ceilingFeet: Math.min(ceilingFeet, wallTopFeetOf(token, pos)), height };
  }
  // §217: the wall stops before the ceiling (or is open-air) — it is the top, and the limit.
  const wallTop = wallTopFeetOf(token, pos);
  if ( wallTop < ceilingFeet - 1e-6 ) return { top: { kind: "wallEnd", at: wallTop + height }, ceilingFeet: wallTop, height };
  return { top: Number.isFinite(ceiling) ? { kind: "ceiling", at: ceilingFeet + height } : null, ceilingFeet, height };
}

/**
 * §216: the scene levels that start above these feet (markers of the climb gauge): name and elevation of the bottom, from
 * lowest to highest. Players already see them in the core's level navigator.
 * @returns {Array<{at: number, name: string}>}
 */
export function levelMarksAbove(token, feet) {
  const out = [];
  for ( const level of token?.parent?.levels ?? [] ) {
    const bottom = Number(level.elevation?.bottom);
    if ( Number.isFinite(bottom) && (bottom > feet + 1e-6) ) out.push({ at: bottom, name: level.name });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * §216: the edges from which this token can let itself hang, to climb down along the wall — on the ground (on a roof, a
 * wall walk, a story), a neighboring cell whose floor is lower by at least one cell, without a wall on its own level between the
 * two (a parapet is crossed otherwise), and a wall to grab on the other side. It ends up hanging there, head at edge height.
 * @returns {{dir: string, x: number, y: number, elevation: number, level: string, drop: number}[]}
 */
export function edgesBelowOf(token) {
  if ( !token?.parent?.grid || isClimbing(token) ) return [];
  const scene = token.parent;
  const grid = scene.grid;
  const pos = committedPosition(token);
  const feet = pos.elevation ?? 0;
  if ( feet > groundUnder(token, pos) + 1e-6 ) return [];   // in the air: nothing under the feet to start from
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * grid.distance;
  const own = pos.level ?? token._source.level;
  const out = [];
  for ( const { di, dj, dir } of LEDGE_DIRS ) {
    const at = { ...pos, x: pos.x + (dj * grid.sizeX), y: pos.y + (di * grid.sizeY) };
    // The ground continues on its own level (the roof, the floor goes on): not an edge.
    const beside = boundsUnder(token, { ...at, level: own, elevation: feet }).ground;
    if ( Number.isFinite(beside) && (beside > feet - grid.distance + 1e-6) ) continue;
    // Hanging: head at the edge, feet one creature height lower, on the level of that height.
    const hang = feet - height;
    const level = levelAt(scene, hang, own);
    const { ground } = boundsUnder(token, { ...at, level, elevation: hang });
    if ( !Number.isFinite(ground) || (ground > feet - grid.distance + 1e-6) ) continue;   // no gap of at least one cell
    const elevation = Math.max(hang, ground);
    // From a covered room, not through its wall; from an open-air roof, over the guardrail of its edge.
    if ( Number.isFinite(boundsUnder(token, pos).ceiling) && crossingBlocked(token, pos, at, own, feet + 1) ) continue;
    if ( !wallsNear(token, { ...at, level, elevation }).length ) continue;   // nothing to grab
    out.push({ dir, x: at.x, y: at.y, elevation, level, drop: feet - ground });
  }
  return out;
}

/**
 * §217: how far this wall rises — the highest elevation of the feet where the climber still holds the wall, cell by cell,
 * with the fall's own test (`holdsWallAt`, runtime/climb.mjs: a wall near it on the level of that height). Beyond, it would
 * have nothing to grab and would fall: the climb stops there.
 */
export function wallTopFeetOf(token, pos=committedPosition(token)) {
  const scene = token?.parent;
  const grid = scene?.grid;
  const feet = pos.elevation ?? 0;
  if ( !grid ) return Infinity;
  const own = pos.level ?? token._source.level;
  let top = feet;
  for ( let i = 1; i <= MAX_CLIMB_CELLS; i++ ) {
    const elevation = feet + (i * grid.distance);
    const level = levelAt(scene, elevation, own);
    if ( !wallsNear(token, { ...pos, elevation, level }).length ) return top;
    top = elevation;
  }
  return Infinity;
}

