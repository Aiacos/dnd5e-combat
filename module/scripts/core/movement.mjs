/**
 * Movement: what has been spent, where to stand to reach a target, which attack is "the basic attack". Pure core,
 * in cells.
 */

/**
 * Movement spent this turn: the sum of the costs, excluding teleportation and forced movement (SPEC §16.10: Misty Step,
 * a push do not consume the creature's movement). `teleport`: the segment's action is one of those that the
 * core marks `teleport` (`blink`, `displace`).
 * @param {Array<{cost: number, teleport?: boolean}>} waypoints  The turn's movement history.
 * @returns {{spent: number, excluded: number}}  `excluded`: what the core's history counts in addition.
 */
export function spentMovement(waypoints) {
  let spent = 0;
  let excluded = 0;
  for ( const w of waypoints ?? [] ) {
    if ( !Number.isFinite(w.cost) ) continue;
    if ( w.teleport ) excluded += w.cost;
    else spent += w.cost;
  }
  return { spent, excluded };
}

/**
 * Gap in cells between two rectangular footprints (top-left corner `i`,`j`, size `w`×`h`):
 * 0 if they overlap, 1 if they touch, etc. With eight neighbors, like D&D distances.
 */
export function footprintGap(a, b) {
  const gap = (a0, aLen, b0, bLen) => Math.max(0, b0 - (a0 + aLen - 1), a0 - (b0 + bLen - 1));
  const di = gap(a.i, a.h, b.i, b.h);
  const dj = gap(a.j, a.w, b.j, b.w);
  const overlap = (di === 0) && (dj === 0);
  return overlap ? 0 : Math.max(di, dj, 1);
}

/**
 * Arrival test and estimate for approaching a target to `reachCells` cells or fewer, without overlapping it.
 * @param {{i,j,w,h}} target  Footprint of the target.
 * @param {{w,h}} mover       Size of the one approaching.
 */
export function approach(target, mover, reachCells) {
  const gapAt = cell => footprintGap({ i: cell.i, j: cell.j, w: mover.w, h: mover.h }, target);
  return {
    isGoal: cell => { const g = gapAt(cell); return (g >= 1) && (g <= reachCells); },
    heuristic: cell => Math.max(0, gapAt(cell) - reachCells)
  };
}

/**
 * The basic attack among candidates: melee first (it is the one carried out by clicking
 * on an enemy, even if it means moving closer), otherwise the ranged attack. On equal rank, the equipped weapon
 * before the natural attack, then the sheet's order.
 * @param {{id:string, melee:boolean, equipped:boolean, sort:number}[]} candidates
 */
export function chooseBasicAttack(candidates) {
  const rank = c => (c.melee ? 0 : 2) + (c.equipped ? 0 : 1);
  return candidates.slice().sort((a, b) => (rank(a) - rank(b)) || ((a.sort ?? 0) - (b.sort ?? 0)))[0] ?? null;
}

/**
 * Direction of a push (Shove, SPEC §15.2): from the source to the target, rounded to one of the
 * eight grid directions. `i` is the row (downward), `j` the column (rightward).
 * Source and target coincident: no direction.
 * @param {{x: number, y: number}} from  Center of the source.
 * @param {{x: number, y: number}} to    Center of the target.
 * @returns {{di: -1|0|1, dj: -1|0|1}|null}
 */
export function pushDirection(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if ( (Math.abs(dx) < 1e-9) && (Math.abs(dy) < 1e-9) ) return null;
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const angle = octant * (Math.PI / 4);
  return { di: Math.round(Math.sin(angle)) || 0, dj: Math.round(Math.cos(angle)) || 0 };
}

/**
 * Movement cost of a grappler who drags or carries its victim (2024 rule, glossary "Grappled":
 * "its movement costs are doubled, unless you are Tiny or your size category is at least two steps
 * smaller than its"). Sizes as numeric ranks (Tiny 0, Small 1, Medium 2, Large 3, Huge 4, Gargantuan 5).
 * @param {number} grapplerSize
 * @param {number[]} victimSizes  The dragged victims (empty: no surcharge).
 * @returns {1|2}
 */
export function dragMultiplier(grapplerSize, victimSizes) {
  const heavy = victimSizes.some(v => (v > 0) && (v > grapplerSize - 2));
  return heavy ? 2 : 1;
}

/**
 * §281: the multiplier of a grappler that the content enlarges (`grappleSize`, "Heavyweight") — `bonus` sizes larger, and no
 * surcharge for a victim at most `freeUpTo` sizes larger than it (0: "your size or smaller"); null: the rule alone.
 */
export function dragMultiplierWith(grapplerSize, victimSizes, { bonus=0, freeUpTo=null }={}) {
  if ( Number.isInteger(freeUpTo) && victimSizes.every(v => v <= grapplerSize + freeUpTo) ) return 1;
  return dragMultiplier(grapplerSize + bonus, victimSizes);
}

/**
 * Cost ceiling for the turn of a grappler who drags its victim: what remains for it to travel counts
 * double. `cap` and `spent` include the history, in the grid's unit.
 */
export function dragAllowance(cap, spent, multiplier) {
  if ( !Number.isFinite(cap) || (multiplier <= 1) ) return cap;
  return spent + (Math.max(0, cap - spent) / multiplier);
}

/**
 * Is the creature's Speed 0 — no movement mode left to it (Grappled, Restrained, Paralyzed, Unconscious…: dnd5e
 * then sets all its speeds to 0)? Jumping is not a Speed. Without movement data: no.
 * @param {Record<string, number>|null|undefined} speeds  `system.attributes.movement.speeds` (or `movement` before dnd5e 6).
 * @returns {boolean}
 */
export function speedIsZero(speeds) {
  if ( !speeds || (typeof speeds !== "object") ) return false;
  return !["walk", "burrow", "climb", "fly", "swim"].some(mode => (Number(speeds[mode]) || 0) > 0);
}

/**
 * §229: the speed that bounds a movement according to the token's movement action (walk, fly, swim…), like dnd5e's rule
 * colors it (canvas/ruler.mjs, `#getSpeedBasedStyle`): that action's speed; for an action that falls back to walking
 * (`walkFallback`: climbing, swimming) or that is not a dnd5e mode (`ethereal`, crawling…), the greater of the two. Before, the
 * engine read only walking: a flying Wraith (walk 5 ft, fly 60 ft) advanced only 5 ft from the context menu.
 * Climbing keeps its rule (`climbSpeed`, core/climb.mjs: the ×2 without a climb speed is in dnd5e's cost).
 * @param {Record<string, number>} speeds   `system.attributes.movement.speeds`.
 * @param {string|null} action             The movement action (`token.movementAction`), null: walking.
 * @param {Record<string, {walkFallback?: boolean}>} types   `CONFIG.DND5E.movementTypes`.
 * @returns {number}
 */
export function actionSpeed(speeds, action, types={}) {
  const walk = Number(speeds?.walk) || 0;
  if ( !action || (action === "walk") ) return walk;
  const own = Number(speeds?.[action]) || 0;
  return (types[action]?.walkFallback || !types[action]) ? Math.max(own, walk) : own;
}

/**
 * §461: the distance of a declared teleportation (content `teleport`) — `{ distance, units }` if the entry gives it, otherwise the
 * range of its activity when it is a length (dnd5e `range.value` / `range.units`: "teleports up to [range]"). null: nothing
 * readable ("self", "touch", special or empty range) — no teleportation without a limit.
 * @param {{distance?: number, units?: string}|null} rule
 * @param {{value?: *, units?: string}|null} [range]  The range of the activity used.
 * @returns {{distance: number, units: string}|null}
 */
export function teleportReach(rule, range=null) {
  if ( !rule ) return null;
  if ( ("distance" in rule) || ("units" in rule) ) {
    const distance = Number(rule.distance);
    return (Number.isFinite(distance) && (distance > 0) && rule.units) ? { distance, units: rule.units } : null;
  }
  const value = Number(range?.value);
  return (["ft", "m", "mi", "km"].includes(range?.units) && Number.isFinite(value) && (value > 0)) ? { distance: value, units: range.units } : null;
}

/**
 * Can the path preview touch a token's planned movement entry? Yes if it is empty or if it is its own
 * (`own`: the one it placed); no if it is another's — the core's drag, with the route of a pathfinding
 * module.
 * @param {object|null|undefined} current  The entry in place.
 * @param {object|null|undefined} own      The last entry placed by the preview.
 * @returns {boolean}
 */
export function ownsPlannedMovement(current, own) {
  return !current || (current === own);
}
