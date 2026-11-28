/**
 * The ground under a token, and what a creature can do with its movement modes (SPEC §17.4).
 *
 * Verified:
 *  - the ground of a V14 scene is a **Surface** that stops movement: `Scene#getSurfaces({ type: "move", level })`
 *    (client/documents/scene.mjs:793), sorted by increasing elevation, each with `elevation` and `region`. dnd5e 6.0.3
 *    looks up the surface that supports a token the same way (`TokenDocument5e#_findSupportingSurface`,
 *    documents/token.mjs:294 — internal, so re-read here and not called) and, lacking a surface on the scene, takes the
 *    level's base (`level.elevation.base`)
 *  - a level has a slice `elevation.bottom`/`top` (null = infinite): only a surface in that slice is the ground of
 *    that level — the floor of the storey above may be listed in the level below (Restored Keep, §14.2)
 *  - prepared speeds are in `system.attributes.movement.speeds` (data/actor/templates/attributes.mjs:535), already
 *    reduced to 0 by Prone, Grappled, Restrained…
 */

import { MODULE_ID } from "../constants.mjs";
import { placementOf, modeRefusal, speedFor } from "../core/altitude.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "./units.mjs";
import { committedPosition, positionOf, tokenCenter } from "./turn.mjs";

const rangeOf = level => ({ bottom: level?.elevation?.bottom ?? -Infinity, top: level?.elevation?.top ?? Infinity });

/**
 * The ground elevation of a level at a point of the scene: the highest `move` surface of its slice that contains the
 * point; failing that, a surface lower than the level (the courtyard seen from the upper floor: no upper floor
 * above it, its ground is the ground floor's); otherwise the base of the scene's initial level if it is lower, or that
 * of the level (0 without a level). With no surface at all on the
 * scene, each level is a storey whose base is the ground, as dnd5e assumes (documents/token.mjs:330).
 * @param {Scene} scene
 * @param {string|null} levelId
 * @param {{x: number, y: number}} point
 */
export function groundAt(scene, levelId, point) {
  const level = (levelId && scene.levels?.get?.(levelId)) || null;
  const { bottom, top } = rangeOf(level);
  const covers = surface => surface.region?.polygonTree?.testPoint(point);
  const own = scene.getSurfaces?.({ type: "move", ...(level ? { level: level.id } : {}) }) ?? [];
  for ( let n = own.length; n--; ) {
    const surface = own[n];
    if ( (surface.elevation >= bottom) && (surface.elevation < top) && covers(surface) ) return surface.elevation;
  }
  const all = scene.getSurfaces?.({ type: "move" }) ?? [];
  if ( Number.isFinite(bottom) ) {
    for ( let n = all.length; n--; ) if ( (all[n].elevation < bottom) && covers(all[n]) ) return all[n].elevation;
  }
  // No floor under the point, on a scene that has some: above the void on an upper floor, the ground is that of the
  // scene's initial level (the ground floor), not the base of the upper floor — seen in play on 2026-09-26: descended
  // from the floor above the courtyard, the token "passed under the ground" at 15 ft.
  const base = level?.elevation?.base ?? 0;
  const initial = all.length ? scene.initialLevel?.elevation?.base : undefined;
  return (Number.isFinite(initial) && (initial < base)) ? initial : base;
}

/**
 * The level of an elevation: the one whose slice `[bas, haut[` contains it. The current level if it still contains it,
 * or if there is none or there are several (same rule as dnd5e when a fall ends, documents/token.mjs:355).
 * The V14 core never changes a token's level based on its elevation: only a staircase (`changeLevel`) does.
 * @param {Scene} scene
 * @param {number} elevation
 * @param {string} currentId
 * @returns {string}
 */
export function levelAt(scene, elevation, currentId) {
  const contains = level => { const { bottom, top } = rangeOf(level); return (elevation >= bottom) && (elevation < top); };
  const current = scene.levels?.get?.(currentId);
  if ( !scene.levels?.size || (current && contains(current)) ) return currentId;
  const homes = scene.levels.filter(contains);
  return (homes.length === 1) ? homes[0].id : currentId;
}

/** The center of a token at a position (source or waypoint), in 2D. */
function centerAt(token, pos) {
  const { x, y } = tokenCenter(token, pos);
  return { x, y };
}

/** The ground under a token, at its validated position or at `pos`. */
export function groundUnder(token, pos=committedPosition(token)) {
  return groundAt(token.parent, pos.level ?? token._source.level, centerAt(token, pos));
}

/**
 * The ceiling at a point, seen from a given ground: the lowest `move` surface above that ground that contains the point,
 * **whatever level it is attached to**. Infinity: none. The top of the level is not a ceiling: without a
 * surface, you go up into the level above (`levelAt`).
 * Seen in play on 2026-09-26 ("Magicien des vins"): a token that flies with its feet ON a surface can no longer descend —
 * the core treats it as solid below when the ray starts from it (`side: "below"`, scene.mjs:810). And the core
 * only tests the surfaces of the token's level: the upper floor's floor, attached to the upper floor alone, let a token go up
 * through it from the ground floor. A floor stops a flight wherever it comes from.
 * The core stops a token as soon as part of it passes under a floor (rays from the feet, the center and the head,
 * placeables/token.mjs:3222-3232): at a building's edge, the center alone is not enough — the token's control points are tested
 * (`TokenDocument#getContainmentTestPoints`, documents/token.mjs:3348), and a single one under the floor is enough.
 * @param {Scene} scene
 * @param {{x: number, y: number}|{x: number, y: number}[]} points
 * @param {number} ground
 */
export function ceilingAt(scene, points, ground) {
  const list = Array.isArray(points) ? points : [points];
  for ( const surface of scene.getSurfaces?.({ type: "move" }) ?? [] ) {   // sorted by increasing elevation
    if ( !Number.isFinite(surface.elevation) || (surface.elevation <= ground + 1e-6) ) continue;
    if ( list.some(p => surface.region?.polygonTree?.testPoint(p)) ) return surface.elevation;
  }
  return Infinity;
}

/**
 * Where a token can stand at a position: `ground` (ground) and `ceiling` (highest elevation for its feet in flight:
 * ceiling minus its height, V14 core `depth` in cells).
 */
export function boundsUnder(token, pos=committedPosition(token)) {
  const scene = token.parent;
  const levelId = pos.level ?? token._source.level;
  const point = centerAt(token, pos);
  const ground = groundAt(scene, levelId, point);
  const height = (positionOf({ ...token._source, ...pos }).depth ?? 1) * scene.grid.distance;
  let points = [point];
  try { points = [point, ...token.getContainmentTestPoints({ ...token._source, ...pos })]; }
  catch { /* API absente : le centre */ }
  return { ground, ceiling: ceilingAt(scene, points, ground) - height };
}

/** 5 ft (rule: minimum gap from the ground when flying or burrowing, and height of a step), in the scene's unit. */
export function clearanceOf(scene) {
  try { return convertLength(5, "ft", scene.grid.units, readUnitFactors()); }
  catch { return scene.grid.distance; }
}

export const speedsOf = actor => actor?.system?.attributes?.movement?.speeds ?? actor?.system?.attributes?.movement ?? {};

/** Why this creature cannot take this mode, or null. */
export const modeRefusalFor = (actor, action) => modeRefusal(action, speedsOf(actor));

/* -------------------------------------------- */
/*  Speed granted by choosing the mode          */
/* -------------------------------------------- */

/**
 * The effects the engine placed to grant a speed (flag `grantedSpeed` = the speed: `fly`, `burrow`).
 * @param {Actor5e} actor
 */
export const grantedSpeedEffects = actor => (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "grantedSpeed"));

/**
 * Choosing a mode in the token HUD counts as a decision by the GM or the player: a creature without that speed gets
 * it, equal to its walking speed (30 ft if it has none), through an effect named after the mode. Same kind of
 * change as dnd5e's features that grant flight (Dragon Wings: `system.attributes.movement.fly`,
 * `upgrade`, packs/_source/classes24/sorcerer/…/dragon-wings.yml:159).
 * @param {TokenDocument} token
 * @param {string} action  The chosen mode.
 * @returns {Promise<boolean>}  true if an effect was placed.
 */
export async function grantSpeedFor(token, action) {
  const speed = speedFor(action);
  const actor = token.actor;
  if ( !speed || !actor || !modeRefusalFor(actor, action) ) return false;
  const walk = Number(speedsOf(actor).walk) || Number(actor.system?.attributes?.movement?.walk) || 30;
  const config = CONFIG.Token.movement.actions[action] ?? {};
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format("DND5ECOMBAT.Altitude.VitesseAccordee", { mode: game.i18n.localize(config.label ?? action) }),
    img: config.img ?? "icons/svg/wing.svg",
    system: { changes: [{ key: `system.attributes.movement.${speed}`, value: String(walk), type: "upgrade", phase: "initial" }] },
    flags: { [MODULE_ID]: { grantedSpeed: speed } }
  }]);
  return true;
}

/**
 * Removes the granted speeds that the `action` mode no longer needs (back to walking: the granted flight drops).
 * @returns {Promise<number>}  Number of effects removed.
 */
export async function revokeSpeedsBut(token, action) {
  const keep = speedFor(action);
  const ids = grantedSpeedEffects(token.actor).filter(e => e.getFlag(MODULE_ID, "grantedSpeed") !== keep).map(e => e.id);
  if ( ids.length ) await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

/** A creature's ground mode: crawl if it can only crawl (Prone), otherwise walk. */
export const groundModeOf = actor => (actor?.hasConditionEffect?.("crawl") ? "crawl" : "walk");

/**
 * The mode in which the token is really moving: its own, except a ground mode clearly in the air (or underground) —
 * a creature that flies (or burrows) whose mode nobody changed; if it has that speed, that mode applies.
 * @param {TokenDocument} token
 * @param {object} [pos]  Position (starting point of a move), otherwise the validated position.
 */
export function effectiveMode(token, pos=committedPosition(token)) {
  const mode = token.movementAction;
  if ( placementOf(mode) !== "ground" ) return mode;
  const ground = groundUnder(token, pos);
  const step = clearanceOf(token.parent);
  const elevation = pos.elevation ?? 0;
  const to = (elevation > ground + step + 1e-6) ? "fly" : ((elevation < ground - step - 1e-6) ? "burrow" : null);
  return (to && !modeRefusalFor(token.actor, to)) ? to : mode;
}

/** Is the token in the air (flying, or above its ground)? §192: a climber clings to the wall, it is not in the air. */
export function isAirborne(token) {
  if ( placementOf(token.movementAction) === "air" ) return true;
  if ( token._source.movementAction === "climb" ) return false;
  return (token._source.elevation ?? 0) > groundUnder(token) + 1e-6;
}
