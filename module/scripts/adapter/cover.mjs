/**
 * Cover read in Foundry for the core (core/cover.mjs): token spaces at VALIDATED positions, walls by the native `move`-type
 * ray cast (a physical obstacle gives cover — a window blocks movement, not sight; fog, the opposite; an open door blocks
 * nothing: it is the core's polygon that knows, `source-polygon.mjs:326`), bodies of the other creatures drawn and not hidden —
 * a dead creature gives cover only if Large or bigger (core/cover.mjs, `bodyGivesCover`).
 *
 * P2 (§14.2): the rays are cast **within the attacker's level** (the polygon's `level` —
 * without it the core takes the displayed level, source-polygon.mjs:187) and, besides walls, against
 * **surfaces** (floors, ceilings: regions with the `defineSurface` behavior), by the scene's 3D ray cast
 * (`Scene#testSurfaceCollision`, client/documents/scene.mjs:810) between the attacker's eye
 * height and the target's (the core's movement origin:
 * feet + half the height). A solid floor between two creatures is Total Cover.
 *
 * Computed on the active GM, at verdict time (runtime/engine.mjs, enrich): one pair per target.
 * A cover condition placed by hand by the GM (`coverHalf`…) wins: dnd5e has already counted it in
 * the AC, it is not recomputed.
 */

import { MODULE_ID } from "../constants.mjs";
import { coverBetween, bodyGivesCover, strongerCover, pullBack, COVER, GRATE_MODES, grateOf, windowOpen } from "../core/cover.mjs";
import { crossesWall } from "../core/wall.mjs";
import { contentOf } from "./content.mjs";
import { grappleRulesOf } from "./grapple-rules.mjs";
import { victimsOf } from "./grapple.mjs";
import { wallGeometryOf } from "./wall-side.mjs";
import { committedPosition } from "./turn.mjs";
import { isDeadActor } from "./death.mjs";
import { isObjectToken } from "./bodies.mjs";

const COVER_STATUSES = ["coverHalf", "coverThreeQuarters", "coverTotal"];
/** Corner inset, as a fraction of a cell: a line running along a wall does not count. */
const INSET_FRACTION = 0.1;

let available = false;
export function setCoverAvailable(value) { available = !!value; }
export function isCoverAvailable() { return available; }

/** What this file asks of the core, checked once at `ready`. */
export function checkCoverApi() {
  return (typeof CONFIG.Canvas?.polygonBackends?.move?.testCollision === "function") ? [] : ["CONFIG.Canvas.polygonBackends.move.testCollision"];
}

/**
 * Can this client's canvas judge cover in this scene? It must be ready AND display this scene: walls come from the canvas
 * edges (the `move` polygon), bodies from the drawn tokens. During a level change, the V14 core redraws the whole canvas
 * (`Canvas#draw` → `tearDown`, client/canvas/board.mjs:1122-1151): `canvas.ready` is false during
 * the redraw — seen on 2026-09-23, an attack through a floor judged "no cover" during that time.
 */
export function canJudgeCover(scene) {
  return available && !!canvas?.ready && !!scene && (canvas.scene === scene) && !checkCoverApi().length;
}

/** A token's space in pixels, at its validated position (or at `pos`). */
export function rectOf(doc, pos=committedPosition(doc)) {
  const grid = doc.parent.grid;
  return { x: pos.x, y: pos.y, width: Math.max(pos.width ?? 1, 0.5) * grid.sizeX, height: Math.max(pos.height ?? 1, 0.5) * grid.sizeY };
}

/** A token's eye height at a position: feet + half its height (like the core's `getMovementOrigin`). */
export function eyeElevation(doc, pos=committedPosition(doc)) {
  return (pos.elevation ?? 0) + ((pos.depth ?? 1) * doc.parent.grid.distance / 2);
}

/** §468: the old flag of a "grate" wall (checkbox ticked in 0.284–0.286) — `true` equals the "grate" choice. */
export const GRATE_FLAG = "grate";
/** §476: the wall's choice — "auto" (per the world setting), "grate" (a grate), "solid" (solid wall). */
export const GRATE_MODE_FLAG = "grateMode";
/** §476: world setting — any wall that stops movement without blocking sight is a grate (off by default). */
export const GRATE_SETTING = "grateWalls";

/** §476: this WallDocument's "grate" choice; a wall ticked before §476 (`grate: true`) remains a grate. */
export function grateModeOf(doc) {
  const mode = doc?.getFlag?.(MODULE_ID, GRATE_MODE_FLAG);
  if ( GRATE_MODES.includes(mode) ) return mode;
  return (doc?.getFlag?.(MODULE_ID, GRATE_FLAG) === true) ? "grate" : "auto";
}

/** §476: the "Grate walls" world setting. */
export function grateWallsAuto() {
  try { return game.settings.get(MODULE_ID, GRATE_SETTING) === true; } catch { return false; }
}

/**
 * §468, §476: is this wall a grate? (a WallDocument, or the drawn Wall; anything else (scene edge): no)
 * @param {object} wall
 * @param {{auto?: boolean, mode?: string}} [opts]  `auto`: the world setting's value (read otherwise); `mode`: a choice to try.
 */
export function isGrate(wall, { auto=grateWallsAuto(), mode }={}) {
  const doc = wall?.document ?? wall;
  if ( typeof doc?.getFlag !== "function" ) return false;
  const none = CONST.EDGE_SENSE_TYPES?.NONE ?? 0;
  return grateOf({ mode: mode ?? grateModeOf(doc), auto, blocksSight: (doc.sight ?? none) !== none,
    spellWall: !!(doc.getFlag(MODULE_ID, "zone") || doc.getFlag(MODULE_ID, "ethereal")) });
}

/**
 * §468: what cuts the segment `from` → `to` in the movement polygon: `"wall"` (at least one solid obstacle), `"grate"`
 * (only grates), or false. The core's "all" mode returns each contact point with its edges
 * (clockwise-sweep.mjs:759-787); the object of a wall edge is its WallDocument (documents/wall.mjs:166). An edge that is not
 * a wall (scene edge…) counts as solid.
 */
export function wallKindBetween(from, to, level, { observer=null }={}) {
  const hits = CONFIG.Canvas.polygonBackends.move.testCollision(from, to, { type: "move", mode: "all", level }) ?? [];
  if ( !Array.isArray(hits) || !hits.length ) return false;
  const auto = grateWallsAuto();
  // §518: seen from `observer` (the attacker), a window it is close enough to see through is open: it cuts nothing.
  const edges = hits.map(v => (v.edges?.size ? [...v.edges].filter(e => !(observer && isOpenWindow(e, observer))) : null));
  if ( edges.every(list => list && !list.length) ) return false;
  const solid = edges.some(list => !list || list.some(e => !isGrate(e.object, { auto })));
  return solid ? "wall" : (edges.some(list => list.length) ? "grate" : false);
}

/**
 * §518: is this edge (of a wall) an open window for this observer? The core's sight threshold (`Edge#applyThreshold`,
 * canvas/geometry/edges/edge.mjs:220: "proximity" sight within the threshold, or "distance" beyond), measured like a token's
 * vision (`useThreshold`, sources/point-vision-source.mjs:293): from its center, minus its radius
 * (`Token#externalRadius`, token.mjs:3928).
 * @param {Edge} edge
 * @param {{x: number, y: number, externalRadius?: number}} observer
 */
export function isOpenWindow(edge, observer) {
  const doc = edge?.object?.document ?? edge?.object;
  if ( (typeof doc?.getFlag !== "function") || (typeof edge.applyThreshold !== "function") ) return false;
  return windowOpen({ mode: grateModeOf(doc), spellWall: !!(doc.getFlag(MODULE_ID, "zone") || doc.getFlag(MODULE_ID, "ethereal")),
    seenThrough: edge.applyThreshold("sight", observer, observer.externalRadius ?? 0) === true });
}

/** §518: the point a token sees from, for the window threshold — the center of its space and its radius (`Token#externalRadius`). */
export function observerOf(doc, pos=committedPosition(doc)) {
  const r = rectOf(doc, pos);
  return { x: r.x + (r.width / 2), y: r.y + (r.height / 2), externalRadius: Math.min(r.width, r.height) / 2 };
}

/**
 * The predicate "the line from a to b is cut" between two tokens: walls of `from`'s level, at its
 * eye height, and surfaces between the two eye heights.
 * @param {TokenDocument} from
 * @param {TokenDocument} to
 * @param {object} [positions]  `posA`, `posB`: hypothetical positions; `windows` (§518): a window that `from` sees through
 *                              (sight threshold reached) does not cut the line — an attack's cover, not the line of effect.
 * @returns {(a: {x: number, y: number}, b: {x: number, y: number}) => false|"wall"|"surface"}  #33: what cuts the line.
 */
export function rayBlocker(from, to, { posA, posB, windows=false }={}) {
  const scene = from.parent;
  const pa = posA ? { ...committedPosition(from), ...posA } : committedPosition(from);
  const pb = posB ? { ...committedPosition(to), ...posB } : committedPosition(to);
  const eyeA = eyeElevation(from, pa);
  const eyeB = eyeElevation(to, pb);
  const level = scene.levels?.get?.(pa.level ?? from._source.level) ?? undefined;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  const observer = windows ? observerOf(from, pa) : null;   // §518: the attacker fires through a window open for them
  return (a, b) => {
    const wall = wallKindBetween({ x: a.x, y: a.y, elevation: eyeA }, { x: b.x, y: b.y, elevation: eyeA }, level, { observer });
    if ( wall === "wall" ) return "wall";
    if ( surfaces && (scene.testSurfaceCollision({ x: a.x, y: a.y, elevation: eyeA }, { x: b.x, y: b.y, elevation: eyeB }, { type: "move", mode: "any" }) === true) ) return "surface";
    return wall;   // §468 : "grate" ou false
  };
}

/**
 * §239: pulls a corner of a token's space in front of the first wall that separates it from its center (token's level,
 * eye height), to `margin` pixels from the contact point — the real space of a creature whose cell is cut by a cave wall.
 * @param {TokenDocument} doc
 * @param {object} [pos]      Position (default: the validated position).
 * @param {number} margin
 * @returns {(centre: {x: number, y: number}, corner: {x: number, y: number}) => {x: number, y: number}}
 */
export function spaceClipper(doc, pos, margin) {
  const p = pos ?? committedPosition(doc);
  const eye = eyeElevation(doc, p);
  const level = doc.parent.levels?.get?.(p.level ?? doc._source.level) ?? undefined;
  const backend = CONFIG.Canvas.polygonBackends.move;
  return (centre, corner) => {
    const hit = backend.testCollision({ x: centre.x, y: centre.y, elevation: eye }, { x: corner.x, y: corner.y, elevation: eye },
      { type: "move", mode: "closest", level });
    return pullBack(centre, corner, hit ?? null, margin);
  };
}

/**
 * The other creatures that can get in the way.
 * @param {boolean} [seenOnly]  #33: only those this client sees (a player's preview: an invisible or hidden creature
 *                              must not give itself away by the cover it provides).
 */
function bodiesAround(attacker, target, seenOnly=false) {
  return coverBodies(attacker, target, seenOnly).map(t => rectOf(t));
}

/** #33: the tokens of the creatures that can get between the attacker and the target (see `bodiesAround`). */
export function coverBodies(attacker, target, seenOnly=false) {
  return attacker.parent.tokens
    .filter(t => (t !== attacker) && (t !== target) && t.actor && !t.hidden && t.object && !isObjectToken(t)
      && (!seenOnly || (t.object.isVisible === true))
      && bodyGivesCover({ dead: isDeadActor(t.actor), size: t.actor.system?.traits?.size }));
}

/** A ranged attack with a weapon (shot, or thrown weapon)? */
export function isRangedWeaponAttack(activity, attackMode) {
  if ( (activity?.type !== "attack") || (activity.item?.type !== "weapon") ) return false;
  // O8d (§347): a crossbow (Two-Handed) carries a "twoHanded" mode: the mode counts only if it throws the weapon.
  if ( /ranged|thrown/.test(attackMode ?? "") ) return true;
  return activity.attack?.type?.value === "ranged";
}

/**
 * §172: the cover given by a `coverThrough` spell zone (Blade Barrier: three-quarters) when the line from one center to the other
 * crosses it, neither attacker nor target inside; the strongest of these zones with its spell's name (#33),
 * `{degree, name}`, or null.
 */
function zoneCoverDetail(attacker, target, posA, activity=null, attackMode=null) {
  const a = rectOf(attacker, posA ? { ...committedPosition(attacker), ...posA } : undefined);
  const b = rectOf(target);
  const path = [{ x: a.x + (a.width / 2), y: a.y + (a.height / 2) }, { x: b.x + (b.width / 2), y: b.y + (b.height / 2) }];
  let best = null;
  for ( const region of attacker.parent.regions ) {
    const uuid = region.getFlag("dnd5e", "activity");
    const item = uuid ? fromUuidSync(uuid, { strict: false })?.item : null;
    const rule = item ? contentOf(item).entry?.coverThrough : null;
    if ( !rule ) continue;
    // §173: against ranged weapon attacks only (Wind Wall: arrows, bolts, thrown weapons).
    if ( (rule.against === "rangedWeapon") && !isRangedWeaponAttack(activity, attackMode) ) continue;
    const degree = rule.degree ?? rule;
    if ( attacker.testInsideRegion(region, posA ? { ...committedPosition(attacker), ...posA } : committedPosition(attacker))
      || target.testInsideRegion(region, committedPosition(target)) ) continue;
    const geometry = wallGeometryOf(region);
    if ( geometry && crossesWall(geometry, path) && (!best || (strongerCover(best.degree, degree) !== best.degree)) ) best = { degree, name: item.name };
  }
  return best;
}

/**
 * The target's cover against the attacker, or null if there is nothing to add (no cover, cover already
 * placed by hand, calculation impossible).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {object} [options]
 * @param {object} [options.posA]     Hypothetical position of the attacker (at the end of an approach).
 * @param {boolean} [options.quiet]   No console trace (hover calculation).
 * @param {Activity} [options.activity]   §173: the attack (zone cover may apply only against ranged weapons).
 * @param {string} [options.attackMode]
 * @param {boolean} [options.seenOnly]  #33: count only the creatures this client sees (player-side preview).
 * @returns {{degree: string, bonus: number|null, byCreature: boolean, sources: string[], zone: string|null}|null}
 *          #33: `sources` — "wall", "surface", "creature", "zone" (`zone`: the spell's name), "grapple".
 */
export function coverFor(attacker, target, { posA, quiet=false, activity=null, attackMode=null, seenOnly=false }={}) {
  if ( !attacker?.parent || (attacker.parent !== target?.parent) || !canJudgeCover(attacker.parent) ) return null;
  if ( COVER_STATUSES.some(s => target.actor?.statuses.has(s)) ) return null;
  const grid = attacker.parent.grid;
  const inset = grid.size * INSET_FRACTION;
  const pa = posA ? { ...committedPosition(attacker), ...posA } : undefined;
  const cover = coverBetween({
    attacker: rectOf(attacker, pa), target: rectOf(target), bodies: bodiesAround(attacker, target, seenOnly),
    blocked: rayBlocker(attacker, target, { posA, windows: true }), inset,
    clipAttacker: spaceClipper(attacker, pa, inset), clipTarget: spaceClipper(target, undefined, inset)
  });
  // §172: a zone that gives cover to whoever is behind it (Blade Barrier) — the line between the two crosses it.
  let zone = null;
  const behind = zoneCoverDetail(attacker, target, posA, activity, attackMode);
  if ( behind && (strongerCover(cover.degree, behind.degree) !== cover.degree) ) {
    Object.assign(cover, { degree: behind.degree, bonus: COVER[behind.degree].bonus, byCreature: false, sources: ["zone"] });
    zone = behind.name;
  }
  // §281: "Flesh Shield" — whoever grapples a creature has this cover against attacks by creatures it does not grapple.
  const held = grappleRulesOf(target.actor).cover;
  if ( held && (strongerCover(cover.degree, held) !== cover.degree) ) {
    const victims = victimsOf(target);
    if ( victims.length && !victims.includes(attacker) ) {
      Object.assign(cover, { degree: held, bonus: COVER[held].bonus, byCreature: true, sources: ["grapple"] });
      zone = null;
    }
  }
  if ( cover.degree === "none" ) return null;
  if ( !quiet ) console.log(`${MODULE_ID} | cover: ${target.name} against ${attacker.name} — ${cover.degree}${cover.byCreature ? " (creature in between)" : ""}`);
  return { degree: cover.degree, bonus: cover.bonus, byCreature: cover.byCreature, sources: cover.sources ?? [], zone };
}

/** #33: the cover condition placed by hand on the target (`coverHalf`…), as a degree, or null. The strongest of several. */
export function manualCoverOf(target) {
  const statuses = target?.actor?.statuses;
  if ( !statuses ) return null;
  if ( statuses.has("coverTotal") ) return "total";
  if ( statuses.has("coverThreeQuarters") ) return "threeQuarters";
  return statuses.has("coverHalf") ? "half" : null;
}

/**
 * §200: "Clear Path to Target" (Player's Handbook 2024) — a spell's point of origin cannot be behind Total Cover.
 * True if, from the center or a (inset) corner of the caster's space, the line to the point crosses no wall that
 * stops movement (a closed window too: Total Cover) in its level, at eye height, nor floor or ceiling (Surface).
 * §468: a wall ticked "grate" (bars, portcullis) does not stop this path — it is not Total Cover
 * (feedback from Fanarie, 2026-11-17).
 * null: cannot tell (canvas absent or on another scene).
 * @param {TokenDocument} token
 * @param {{x: number, y: number}} point
 * @returns {boolean|null}
 */
export function clearPathTo(token, point) {
  const scene = token?.parent;
  if ( !point || !canJudgeCover(scene) ) return null;
  const pos = committedPosition(token);
  const eye = eyeElevation(token, pos);
  const level = scene.levels?.get?.(pos.level ?? token._source.level) ?? undefined;
  const surfaces = typeof scene.testSurfaceCollision === "function";
  const rect = rectOf(token, pos);
  const inset = scene.grid.size * INSET_FRACTION;
  const starts = [
    { x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) },
    { x: rect.x + inset, y: rect.y + inset }, { x: rect.x + rect.width - inset, y: rect.y + inset },
    { x: rect.x + inset, y: rect.y + rect.height - inset }, { x: rect.x + rect.width - inset, y: rect.y + rect.height - inset }
  ];
  const to = { x: point.x, y: point.y, elevation: eye };
  return starts.some(a => {
    const from = { x: a.x, y: a.y, elevation: eye };
    if ( wallKindBetween(from, to, level) === "wall" ) return false;
    return !(surfaces && (scene.testSurfaceCollision(from, to, { type: "move", mode: "any" }) === true));
  });
}

/**
 * Line of effect between two tokens (P2): exists as long as one does not have **Total** Cover from
 * the other — walls and surfaces, without creatures (they never give more than half cover).
 * This is what stops an Emanation (aura), an Opportunity Attack through a trapdoor.
 * @param {TokenDocument} from
 * @param {TokenDocument} to
 * @param {object} [positions]  `posA`, `posB`: hypothetical positions.
 * @returns {boolean|null}  null: cannot tell (canvas absent, different scenes).
 */
export function hasLineOfEffect(from, to, positions={}) {
  if ( !canvas?.ready || !from?.parent || (from.parent !== to?.parent) || (canvas.scene !== from.parent) || checkCoverApi().length ) return null;
  const grid = from.parent.grid;
  const posA = positions.posA;
  const posB = positions.posB;
  const inset = grid.size * INSET_FRACTION;
  const pa = posA ? { ...committedPosition(from), ...posA } : undefined;
  const pb = posB ? { ...committedPosition(to), ...posB } : undefined;
  const cover = coverBetween({
    attacker: rectOf(from, pa), target: rectOf(to, pb),
    bodies: [], blocked: rayBlocker(from, to, positions), inset,
    clipAttacker: spaceClipper(from, pa, inset), clipTarget: spaceClipper(to, pb, inset)
  });
  return cover.degree !== "total";
}
