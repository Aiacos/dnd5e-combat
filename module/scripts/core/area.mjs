/**
 * Who is affected by an area of effect. dnd5e 6.0 places the area but designates no target:
 * it is up to the engine to say who, among the tokens it covers, must make their save.
 * Pure functions, no dependency on Foundry (SPEC §5.1).
 */

import { alliedSides } from "./factions.mjs";

/**
 * @typedef {object} AreaCandidate
 * @property {string} token        UUID of the token.
 * @property {string} actor        UUID of its actor.
 * @property {string} name
 * @property {number} disposition  -1 hostile, 0 neutral, 1 friendly (Foundry values), -2 secret.
 * @property {boolean} [defeated]  Creature out of the fight (dead), which an area no longer has to resolve.
 * @property {boolean|null} [inVolume]  For a sphere: is the creature in the sphere and not only in the region's
 *   cylinder (P2)? false excludes it; null or absent does not exclude it.
 * @property {boolean|null} [lineOfEffect]  Does the area reach it (no floor, no ceiling between its origin and
 *   the creature — P2, §14.2)? false excludes it; null or absent (impossible to tell) does not exclude it.
 */

/**
 * @param {AreaCandidate[]} candidates       Tokens covered by the area.
 * @param {object} options
 * @param {string|null} options.origin       UUID of the token at the origin of the area.
 * @param {number|null} options.originDisposition
 * @param {boolean} options.excludeOrigin    Area starting from the caster ("self" range): they are not part of it.
 * @param {string} [options.affects]         The activity's `target.affects.type`: "ally", "enemy", or anything else = everyone.
 * @returns {AreaCandidate[]}
 */
export function selectAreaTargets(candidates, { origin, originDisposition, originSide=null, excludeOrigin, affects, max=null }) {
  const chosen = candidates.filter(c => {
    if ( c.defeated || (c.lineOfEffect === false) || (c.inVolume === false) || (c.offPlane === true) ) return false;   // §225
    if ( c.token === origin ) return !excludeOrigin && (affects !== "enemy");
    if ( (affects !== "ally") && (affects !== "enemy") ) return true;
    // With no known side for the caster, we do not guess: everyone is affected, the GM will cancel if needed.
    if ( (originDisposition === null) || (originDisposition === undefined) ) return true;
    const sameSide = alliedSides(c, originSide ?? { disposition: originDisposition });   // §181 : factions, sinon dispositions
    return affects === "ally" ? sameSide : !sameSide;
  });
  // §296 (pass C2): "up to six creatures of your choice" (Slow, "Group Healing") — `max`, those closest to the area's center.
  if ( !(Number.isInteger(max) && (max > 0)) || (chosen.length <= max) ) return chosen;
  return [...chosen].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)).slice(0, max);
}

/**
 * §401: those the area CAN affect, whatever the side (line of effect, volume, plane, living; the caster according to the range) —
 * the list that the "creatures of your choice" question offers.
 * @param {AreaCandidate[]} candidates
 * @param {object} options  As for `selectAreaTargets`.
 */
export function eligibleAreaTargets(candidates, options) {
  return selectAreaTargets(candidates, { ...options, affects: "", max: null })
    .filter(c => (c.token !== options.origin) || (options.affects !== "enemy"));
}

/** §401: the settings of the "creatures of your choice" question in an area. */
export const ZONE_CHOICE_MODES = Object.freeze(["mixed", "always", "never"]);

/**
 * §401: must the caster be asked which creatures the area affects? `mixed` (default): only if the automatic choice (allies
 * spared, `max` cap) leaves someone out; `always`: whenever there is someone; `never`: never.
 * @param {string} mode
 * @param {Array<{token: string}>} eligible  `eligibleAreaTargets`.
 * @param {Array<{token: string}>} chosen    `selectAreaTargets` (the automatic choice).
 */
export function zoneChoiceNeeded(mode, eligible, chosen) {
  if ( (mode === "never") || !eligible.length ) return false;
  if ( mode === "always" ) return true;
  const picked = new Set(chosen.map(c => c.token));
  return eligible.some(c => !picked.has(c.token));
}

/**
 * §401: whom a lasting area affects, from the choice made when it was placed (`picked` / `spared`); null if the creature
 * was not there (the automatic rule then decides).
 * @param {{picked?: string[], spared?: string[]}} state
 * @param {string} token  UUID.
 * @returns {boolean|null}
 */
export function pickedAtPose(state, token) {
  if ( state?.spared?.includes(token) ) return false;
  if ( state?.picked?.includes(token) ) return true;
  return null;
}

/* -------------------------------------------- */
/*  Zones qui durent                            */
/* -------------------------------------------- */

/**
 * A lasting area replays its activity (save, damage, effects) against a creature at
 * certain moments, and at most once per game turn (2024 rules: "a creature makes
 * this save only once per turn").
 *
 * Known moments:
 *  - "enter"      the creature enters the area, or the area comes onto it
 *  - "turnStart"  it starts its turn in the area
 *  - "turnEnd"    it ends its turn there
 *  - "moves"      it moves there: on every movement, with no limit per turn, and as many times as cells
 *                 traveled in the area (Spike Growth: "2d4 for every 5 feet"); an area that
 *                 acts only this way does not act when placed
 *
 * @typedef {object} AreaState
 * @property {string[]} on        Moments when the area acts.
 * @property {string} turnKey     Game turn to which `hit` refers.
 * @property {string[]} hit       Tokens already hit during this game turn.
 */

/** Identifies a game turn: everything changes when the turn passes. Out of combat, a single key. */
export function turnKeyOf(round, turn) {
  return (round === null) || (round === undefined) ? "hors-combat" : `${round}-${turn}`;
}

/**
 * A property of an area that applies only from a turn of its caster (`fromPulse`, §367: Storm of Vengeance — Difficult
 * Terrain, no visibility and ranged attacks impossible on "turns 5 to 10"): does it already apply? `rule` absent: no;
 * without `fromPulse` (`true`, `{}`): from placement; otherwise from the caster's `fromPulse` replay (`pulses` of the
 * area's state).
 * @param {true|{fromPulse?: number}|null|undefined} rule
 * @param {number|null|undefined} pulses  The caster's replays already done on this area.
 * @returns {boolean}
 */
export function fromPulseReached(rule, pulses) {
  if ( !rule ) return false;
  const from = Number(rule.fromPulse) || 0;
  return (from <= 0) || ((Number(pulses) || 0) >= from);
}

/**
 * Can the area be moved now (§16.14)? Moonbeam: "on your later turns" — not on the very turn
 * it was placed. Out of combat, always.
 * @param {AreaState} area
 * @param {string} turnKey  The current turn (`turnKeyOf`).
 */
export function canMoveArea(area, turnKey) {
  if ( !area ) return false;
  if ( (turnKey === "hors-combat") || (area.turnKey === "hors-combat") ) return true;
  return area.turnKey !== turnKey;
}

/**
 * The shapes of a region, translated by (dx, dy): circles, ellipses, rectangles by their `x, y`, polygons by their
 * `points` (x0, y0, x1, y1…). The other fields (radius, elevation, holes) do not move.
 * @param {object[]} shapes
 * @returns {object[]}
 */
export function translateShapes(shapes, dx, dy) {
  return (shapes ?? []).map(shape => {
    const out = { ...shape };
    if ( Number.isFinite(out.x) ) out.x += dx;
    if ( Number.isFinite(out.y) ) out.y += dy;
    if ( Array.isArray(out.points) ) out.points = out.points.map((v, i) => v + ((i % 2) ? dy : dx));
    // §540: an Emanation keeps its position in its base shape (a token, a circle…).
    if ( out.base && (typeof out.base === "object") ) out.base = translateShapes([out.base], dx, dy)[0];
    return out;
  });
}

/** The center of a shape (the one whose movement is measured), or null. */
export function shapeCenter(shape) {
  if ( !shape ) return null;
  // §540: the core Emanation (dnd5e's Spirit Guardians, attached to its caster) has no position of its own, only its base's; a token
  // base's x/y is its corner, which moves exactly as its centre does — only the shift between two centres is ever used.
  if ( (shape.type === "emanation") && shape.base ) return shapeCenter(shape.base);
  if ( Array.isArray(shape.points) && shape.points.length >= 2 ) {
    const xs = shape.points.filter((_, i) => !(i % 2));
    const ys = shape.points.filter((_, i) => i % 2);
    return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
  }
  if ( (shape.type === "rectangle") && Number.isFinite(shape.width) ) return { x: shape.x + (shape.width / 2), y: shape.y + (shape.height / 2) };
  return Number.isFinite(shape.x) ? { x: shape.x, y: shape.y } : null;
}

/** Starting state of an area: those it hit when placed were hit for this turn. */
export function openArea(on, turnKey, hit=[]) {
  return { on: [...on], turnKey, hit: [...hit] };
}

/**
 * Must the area act on this token now?
 * @param {AreaState} area
 * @param {{event: string, token: string, turnKey: string}} context
 */
export function shouldTrigger(area, { event, token, turnKey }) {
  if ( !area.on.includes(event) ) return false;
  if ( event === "moves" ) return true;   // every movement counts, with no limit per turn
  return (area.turnKey !== turnKey) || !area.hit.includes(token);
}

/**
 * §80: the sister activity that the area replays at this moment — its own when the area plays several (`activities`, Hunger of
 * Hadar: cold at the start of the turn, acid at the end), otherwise the only one (`activity`), otherwise null (the activity
 * that placed the area).
 * @param {AreaState & {activity?: string|null, activities?: Record<string, string>}} area
 * @param {string} event
 */
export function siblingFor(area, event) {
  return area?.activities?.[event] ?? area?.activity ?? null;
}

/**
 * §80: under which key to note "already hit this turn": the creature, and the activity when the area plays one per moment —
 * the cold of the start of the turn does not prevent the acid of the end. An area with a single activity keeps "once per
 * turn" (Moonbeam).
 * @param {AreaState & {activities?: Record<string, string>}} area
 * @param {string} event
 * @param {string} token  UUID of the token.
 */
export function hitKey(area, event, token) {
  const own = area?.activities?.[event];
  return own ? `${token}#${own}` : token;
}

/**
 * §80: the sister activities of an area, per moment, from its `replay` declarations; only when they differ from one
 * moment to another (otherwise `activity` suffices and nothing changes for Moonbeam, Cordon of Arrows, Stinking Cloud).
 * @param {Array<{on: string[], activity: string|null}>} replays  For each declaration: its moments, the activity replayed.
 * @returns {Record<string, string>|null}
 */
export function siblingsByMoment(replays) {
  const by = {};
  for ( const { on, activity } of replays ?? [] ) if ( activity ) for ( const m of on ) by[m] = activity;
  return (new Set(Object.values(by)).size > 1) ? by : null;
}

/**
 * §91: the entry of a `casterPulse` that applies to replay number `n` (1 = the first turn after placement), or null.
 * @param {{by: {from: number, to?: number}[]}} rule
 * @param {number} n
 */
export function pulseFor(rule, n) {
  return (rule?.by ?? []).find(b => (n >= b.from) && (n <= (b.to ?? b.from))) ?? null;
}

/**
 * §91: the targets of a capped replay (`max`) — the caster's enemies first, then the others, in the given order.
 * @param {{disposition: number}[]} tokens
 * @param {number|null} casterDisposition
 * @param {number} [max]
 */
export function pulseTargets(tokens, casterDisposition, max) {
  // §181: the caster can come as a side (`{ disposition, faction, uuid }`) or as a plain disposition.
  const caster = ((casterDisposition !== null) && (typeof casterDisposition === "object")) ? casterDisposition : { disposition: casterDisposition };
  const hostile = t => (caster.disposition !== null) && (caster.disposition !== undefined) && !alliedSides(t, caster);
  const ordered = [...tokens.filter(hostile), ...tokens.filter(t => !hostile(t))];
  return max ? ordered.slice(0, max) : ordered;
}

/** Notes that a token has just been hit. Changing game turn erases the memory of the previous one. */
export function markHit(area, { token, turnKey }) {
  const hit = area.turnKey === turnKey ? area.hit : [];
  return { ...area, turnKey, hit: hit.includes(token) ? hit : [...hit, token] };
}

/**
 * Cells traveled INSIDE the area (`moves` moment): each step whose arrival is in the area — entering counts, leaving
 * does not.
 * @param {boolean[]} insideAtSteps  For each arrival cell of the path, in order (departure excluded).
 */
export function stepsInside(insideAtSteps) {
  return (insideAtSteps ?? []).filter(Boolean).length;
}

/**
 * §187: the first cell of a path that leads into one of the areas (inside at this cell, not at the previous one), or -1.
 * @param {boolean[][]} rows  For the departure then each cell of the path, in order: inside or not, area by area.
 */
export function firstEntry(rows) {
  for ( let k = 1; k < (rows?.length ?? 0); k++ ) {
    if ( rows[k].some((inside, z) => inside && !rows[k - 1][z]) ) return k;
  }
  return -1;
}

/**
 * §188: an area set ablaze on turn `until` (round, turn) goes out at the end of that turn — "until the end of the turn 2
 * rounds after it was lit". True when the turn that has just ended (`ended`) reaches or passes it.
 */
export function burnedOut(until, ended) {
  if ( !until || !ended || !Number.isFinite(ended.round) ) return false;
  return (ended.round > until.round) || ((ended.round === until.round) && ((ended.turn ?? 0) >= (until.turn ?? 0)));
}

/** Does the area act when placed? No if it acts only on movement (`moves`). */
export function actsOnPose(on) {
  return !on || on.some(m => m !== "moves");
}

/**
 * Does a movement lead into the area? We look at each waypoint, not only
 * the arrival: crossing the area counts.
 * @param {boolean} insideAtOrigin
 * @param {boolean[]} insideAtWaypoints  In path order, arrival included.
 */
export function entersArea(insideAtOrigin, insideAtWaypoints) {
  return !insideAtOrigin && insideAtWaypoints.some(Boolean);
}

/**
 * §551: the elevation slice of an area, as noted in its state (`slice`) — finite bounds only, null for a column without a slice.
 * @param {{bottom?: number|null, top?: number|null}|null|undefined} elevation  `region._source.elevation`.
 * @returns {{bottom: number|null, top: number|null}|null}
 */
export function sliceOf(elevation) {
  const finite = v => ((v === null) || (v === undefined) || !Number.isFinite(Number(v))) ? null : Number(v);
  const bottom = finite(elevation?.bottom);
  const top = finite(elevation?.top);
  return ((bottom === null) && (top === null)) ? null : { bottom, top };
}

/**
 * §300, §551: when the area itself moves (an Emanation following its caster), the token's position as seen from the area
 * BEFORE the move: shifted by the area's own move, horizontally (centre `at`) and vertically (elevation slice). Testing the area
 * as it is now at this shifted position is testing the area as it was at the token's real position (the area moved by d: it was
 * the current area minus d, so the token was inside it iff token + d is inside the current one). Inside: the token was already
 * there, the move does not make it "enter". A vertical move (the caster flies up or down) shifts the slice only, and counts the
 * same way. Unknown before/now: no shift on that axis.
 * §551: before, the shift went the other way (token − d): a step of the caster towards a creature at the Emanation's edge was
 * read as "already inside" (no save), and a creature trailing behind as "entering".
 * @param {{x: number, y: number, elevation?: number}} position  The token's position now.
 * @param {object} move
 * @param {{x: number, y: number}|null} [move.at]       The area's centre before.
 * @param {{x: number, y: number}|null} [move.now]      The area's centre now.
 * @param {{bottom: number|null, top: number|null}|null} [move.sliceBefore]
 * @param {{bottom: number|null, top: number|null}|null} [move.sliceNow]
 * @returns {{x: number, y: number, elevation?: number}|null}  null: nothing known about the move (an area noted before §300).
 */
export function positionBeforeAreaMove(position, { at=null, now=null, sliceBefore=null, sliceNow=null }={}) {
  const shifted = { ...position };
  let known = false;
  if ( at && now ) {
    shifted.x = position.x + (now.x - at.x);
    shifted.y = position.y + (now.y - at.y);
    known = true;
  }
  const delta = (sliceBefore && sliceNow)
    ? (((sliceBefore.bottom !== null) && (sliceNow.bottom !== null)) ? sliceNow.bottom - sliceBefore.bottom
      : (((sliceBefore.top !== null) && (sliceNow.top !== null)) ? sliceNow.top - sliceBefore.top : null))
    : null;
  if ( delta !== null ) {
    shifted.elevation = (Number(position.elevation) || 0) + delta;
    known = true;
  }
  return known ? shifted : null;
}

/**
 * §16.37: the world time (seconds) at which a lasting area without Concentration ends (Daylight: 1 hour), or null if
 * its duration cannot be counted (instantaneous, permanent, special, unknown).
 * @param {number} now                         World time, in seconds.
 * @param {{value: number|string, units: string}} duration  The activity's duration (dnd5e: `value`, `units`).
 * @param {Record<string, number>} minutesPer  Minutes per unit (CONFIG.DND5E.timeUnits.<unité>.conversion).
 */
export function expiryTime(now, { value, units }={}, minutesPer={}) {
  const n = Number(value);
  const perUnit = minutesPer[units];
  if ( !Number.isFinite(now) || !Number.isFinite(n) || (n <= 0) || !Number.isFinite(perUnit) || (perUnit <= 0) ) return null;
  return now + Math.round(n * perUnit * 60);
}
