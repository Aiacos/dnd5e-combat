/**
 * The actions a player commands with the mouse or keyboard (SPEC §11, step 6 bis) — moving,
 * jumping, engaging a target — and what bounds every movement, whatever its
 * source: the turn ceiling and Opportunity Attacks settled BEFORE moving.
 *
 * `ui/pointer.mjs` translates clicks into calls here; it decides nothing. Here, nothing is read from
 * the DOM: what is optional in an intent ("throw" mode, roll with no dialog) arrives as an argument.
 * Nothing is patched: `preMoveToken` is a public hook of the core.
 */

import { mergeIssues } from "../core/forced.mjs";
import { MODULE_ID } from "../constants.mjs";
import { movementAllowance } from "../core/turn.mjs";
import { footprintGap, chooseBasicAttack, dragMultiplier, dragMultiplierWith, dragAllowance } from "../core/movement.mjs";
import { combatantFor, readBudget, writeBudget, movementOf, speedOf, rangeOf, historyCosts, tokenCenter, positionOf, committedPosition, distanceBetween, currentTurnKey } from "../adapter/turn.mjs";
import { jumpCost, LANDING_DC } from "../core/jump.mjs";
import { jumpOptionsOf, landsOnDifficult } from "../adapter/jump.mjs";
import { groundUnder, boundsUnder } from "../adapter/altitude.mjs";
import { fallNow, fallingAloft } from "./altitude.mjs";
import { overlapsVertically, verticalExtent, verticalGap } from "../core/space.mjs";
import { pilotOf, pilotOfActor, commandPlan, commandDistance, commandActivities, summonerToken, isIntangible } from "../adapter/pilot.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { sharesSpaceWith } from "../adapter/space-sharing.mjs";
import { planPath, previewPath, walk, stopAllWalks, cellUnder, footprintOf, sizeOf, cellOf, stairsEntry, walkOptions } from "../adapter/movement.mjs";
import { hasLineOfSight } from "../adapter/vision.mjs";
import { victimsOf, sizeRankOf } from "../adapter/grapple.mjs";
import { grappleRulesOf } from "../adapter/grapple-rules.mjs";
import { basicActionOf, unarmedAttackOf } from "../adapter/basics.mjs";
import { cellsAtGap, footprintDistance } from "../core/orders.mjs";
import { fleeGaps } from "../core/flee.mjs";
import { opportunityThreats, resolveOpportunity, splitForReady } from "./reactions.mjs";
import { route } from "./router.mjs";
import { loc, notice, log, rolledAndShown } from "./shared.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { onTeleport } from "./teleport.mjs";
import { askAnyway } from "./turn.mjs";
import { onDashTemplate, onDashUsed } from "./dash.mjs";
import { onPreMoveToken, noteWindward } from "./move-gate.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { samePlane } from "../adapter/plane.mjs";
import { enclosureBetween } from "../adapter/facts.mjs";
import { useDespiteAntimagic } from "./antimagic.mjs";
export { afterTeleport, currentTeleport, selfTeleportOf, teleportClick, teleportSelf, teleportTo } from "./teleport.mjs";
export { dashLimit, dashPreview, dashProblem, dashRefusal, dashStrike, dashTargets, lineDashOf, transpose } from "./dash.mjs";

/* -------------------------------------------- */
/*  Ce que le tour permet                       */
/* -------------------------------------------- */

/**
 * Turn cost ceiling (history included), or Infinity out of combat. A grappler dragging its victim
 * (Grappled, "Movable") pays double what it has left, unless the victim is Tiny or two sizes smaller.
 */
export function movementCap(token) {
  const pilot = pilotOf(token);
  if ( pilot ) return pilotCap(token, pilot);
  const combatant = token.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return Infinity;
  const movement = movementOf(combatant, readUnitFactors());
  if ( !movement ) return Infinity;
  const budget = readBudget(combatant);
  // §16.59: a turn finished by an order (Command: Grovel, Halt…) — not one more step.
  if ( budget.stopped ) return movement.spent + historyCosts(token).excluded;
  // §17.2: the core only knows its history; the stairs' height and the survey are subtracted here.
  // §208: a fixed jump (9 m for 3 m) returns the difference to the ceiling, compared with the core's history,
  // which counts the whole distance.
  // §403: the Gust of Wind extra cost (`windward`) is subtracted too.
  const cap = movementAllowance(budget, movement.speed) - (Number(budget.climbed) || 0) - (Number(budget.stood) || 0) + (Number(budget.jumped) || 0)
    - (Number(budget.windward) || 0);
  // The ceiling is compared with the CORE's history, which also counts teleportations (§16.10): they are added back here.
  const excluded = historyCosts(token).excluded;
  const victims = victimsOf(token);
  if ( !victims.length ) return cap + excluded;
  // §281: a grappler that content makes larger ("Heavyweight") drags a victim of its size or smaller without extra cost.
  const rules = grappleRulesOf(token.actor);
  return dragAllowance(cap, movement.spent, dragMultiplierWith(sizeRankOf(token.actor), victims.map(v => sizeRankOf(v.actor)),
    { bonus: rules.bonus, freeUpTo: rules.dragFree })) + excluded;
}

/**
 * §16.15: a piloted object moves the distance of one command, during its caster's turn, if a command is
 * open or if the caster can still pay for it. Otherwise it no longer moves (ceiling = what it has already traveled).
 */
export function pilotMove(token, pilot) {
  const plan = commandPlan(pilot, "move");
  if ( !plan.combatant ) return { cap: Infinity, issue: null };
  const { spent, excluded } = historyCosts(token);
  const stuck = issue => ({ cap: spent + excluded, issue });
  if ( !plan.ownTurn ) return stuck("PasSonTour");
  // §403: Flaming Sphere — "if you roll it over a creature… the sphere stops moving this turn" (runtime/pilot.mjs).
  if ( token.getFlag?.(MODULE_ID, "stoppedOn") === currentTurnKey() ) return stuck("Arretee");
  if ( plan.pay && !((readBudget(plan.combatant)[plan.pay] ?? 0) > 0) ) return stuck("PasDeCommande");
  return { cap: commandDistance(pilot, readUnitFactors()) + excluded, issue: null };
}

const pilotCap = (token, pilot) => pilotMove(token, pilot).cap;

/** Does another creature (visible, not defeated, whose cell one cannot share — §105) occupy the token's footprint at this position? */
export function occupiedAt(token, position) {
  // §16.15: Bigby's Hand "does not occupy its space" — it neither obstructs nor is obstructed.
  if ( isIntangible(token) ) return false;
  const mine = { ...cellOf(token, position), ...sizeOf(token) };
  // §192: in three dimensions — a climber above an occupied cell is not in it (slice from feet to head).
  const slice = positionOf({ ...token._source, ...position });
  const distance = token.parent.grid.distance;
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  // The footprint first (a cell computation), the slice second (a subtraction): the tests that read the content of items
  // (intangible, shared space) only target tokens that touch the cell. In the reverse order, each step of a walk
  // cost ~16 ms on the Arena (measured on 2026-10-17).
  return token.parent.tokens.some(other => (other !== token) && !other.hidden
    && (footprintGap(mine, footprintOf(other)) === 0) && overlapsVertically(slice, positionOf(other._source), distance)
    && !other.actor?.statuses?.has(defeated) && (other.object?.visible !== false) && !isIntangible(other) && !sharesSpaceWith(token, other));
}

/** Grappled: Speed 0 (dnd5e already sets it) — the engine says so instead of "movement exhausted". */
export const isGrappled = token => token.actor?.statuses?.has("grappled") === true;

/** Range of an activity in cells, for an attack mode. null: no range to hold (self, unlimited). */
export function reachCells(activity, mode=null) {
  const range = rangeOf(activity, mode ?? "melee");
  const grid = canvas.scene.grid;
  const toCells = value => {
    let v = lengthIn(value, range.units, grid.units);
    return Math.max(1, Math.floor((v / grid.distance) + 1e-6));
  };
  if ( ["self", "spec", "any"].includes(range.units) ) return null;
  if ( range.units === "touch" ) return { normal: 1, long: 1 };
  if ( !range.value ) return (activity.type === "attack") ? { normal: 1, long: 1 } : null;
  return { normal: toCells(range.value), long: toCells(range.long ?? range.value) };
}

/**
 * §192 (batch 2): the gap between two tokens in cells, in three dimensions — the engine's distance (`distanceBetween`, from feet
 * to head, the scene's diagonal rule) converted to cells: 0 overlapping or in vertical contact, 1 at one cell (5 ft)…
 * The same count as `footprintGap` on the ground, and a target hanging from the ceiling (feet at 15 ft) counts its 10 ft of void.
 * `positions`: `posA` / `posB`, an arrival position or a waypoint.
 */
export function gapCells(a, b, positions={}) {
  const { value } = distanceBetween(a, b, positions);
  return Math.max(0, Math.round((value / a.parent.grid.distance) - 1e-6));
}

/** §192: the vertical void between two tokens (from the head of one to the feet of the other), in cells; 0 when their slices overlap. */
export function verticalGapCells(a, b, { posA, posB }={}) {
  const distance = a.parent.grid.distance;
  const pa = posA ? { ...committedPosition(a), ...posA } : committedPosition(a);
  const pb = posB ? { ...committedPosition(b), ...posB } : committedPosition(b);
  return verticalGap(verticalExtent(pa, distance), verticalExtent(pb, distance)) / distance;
}

/**
 * §192: is the target out of reach by the vertical void alone (on the ceiling, in flight)? Then no approach on the ground
 * leads there: one does not walk to stand underneath. `reach`: the reach in cells (`reachCells`).
 */
export const tooHighFor = (token, target, reach) => !!reach && (verticalGapCells(token, target) > reach.normal + 1e-6);

/** A creature's weapon attacks, and the one that a click on an enemy triggers. */
export function weaponAttacks(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    if ( item.type !== "weapon" ) continue;
    const activity = item.system.activities?.find(a => a.type === "attack");
    if ( !activity ) continue;
    const equipped = (actor.type === "npc") || (item.system.equipped === true);
    if ( !equipped ) continue;
    out.push({ id: activity.uuid, activity, melee: activity.attack?.type?.value !== "ranged", equipped, sort: item.sort ?? 0 });
  }
  return out;
}

/**
 * The attack that a click on an enemy triggers: the base weapon, or for a piloted object (§16.15) the first attack
 * of its commands ("Move and Attack" of Spiritual Weapon).
 */
export function basicAttack(actor) {
  const weapon = chooseBasicAttack(weaponAttacks(actor));
  if ( weapon ) return weapon;
  const pilot = pilotOfActor(actor);
  // §241: no weapon equipped — the unarmed attack (the empty hand of an interface's weapon sets).
  const activity = pilot ? commandActivities(pilot).find(a => a.type === "attack") : unarmedAttackOf(actor);
  return activity ? { id: activity.uuid, activity, melee: activity.attack?.type?.value !== "ranged" } : null;
}

/** Hostility: factions, otherwise dispositions (§181). A piloted object ("secret" disposition) takes its caster's side. */
export function hostileTo(me, other) {
  const pilot = pilotOf(me);
  return areEnemies(pilot ? (summonerToken(pilot) ?? me) : me, other);
}

/** §225: a creature of another plane (Ethereal) can be neither targeted nor touched — the refusal in plain text, or null. */
export function planeRefusal(token, target) {
  if ( !target || (target === token) ) return null;
  if ( !samePlane(token, target) ) return loc("Retour.AutrePlan");
  // §232: an Otiluke's Resilient Sphere between the two (one is inside).
  const sphere = enclosureBetween(token.actor, target.actor);
  return sphere ? loc("Retour.Enferme", { item: sphere.name }) : null;
}

/* -------------------------------------------- */
/*  Actions                                     */
/* -------------------------------------------- */

/**
 * Opportunity Attacks first, the movement second (already checked: preMoveToken does not ask again). `flags`: what
 * the movement operation carries in addition under the module key (`follow`, §41.3), readable in `updateToken`.
 */
async function walkSafely(token, plan, flags={}) {
  if ( plan.waypoints.length ) {
    previewPath(token, null);
    const threats = opportunityThreats(token, plan.waypoints, { explain: true });
    // §211: a readied action triggered along the way — walk to the cell where one arrives within range, let it play, set off again
    // (the rest reviewed as a new walk). Not through a staircase: there, it plays before, like an Opportunity Attack.
    const split = plan.waypoints.some(w => w.action === "displace") ? null : splitForReady(token, plan.waypoints, threats);
    if ( split ) {
      if ( !(await resolveOpportunity(token, split.before)) ) return false;
      if ( split.first.length && !(await walk(token, { ...plan, waypoints: split.first }, { cleared: true, ...flags })) ) return false;
      if ( !(await resolveOpportunity(token, [split.ready])) ) return false;
      return split.rest.length ? walkSafely(token, { ...plan, waypoints: split.rest }, flags) : true;
    }
    if ( !(await resolveOpportunity(token, threats)) ) return false;
  }
  return walk(token, plan, { cleared: true, ...flags });
}

/**
 * Go to the clicked point, on the displayed level — or on `level` (scene level), which only scenarios pass
 * (runtime/testing.mjs): the scenario's GM is not necessarily looking at the arrival level.
 */
export async function moveTo(token, point, { action=null, level=null, forced=false }={}) {
  // §412 (issue #44, batch 5): Grappled, movement exhausted — the legality window; forced, the path with no ceiling,
  // marked `forcedMove`.
  const force = async lines => (await askAnyway(loc("Deplacement.Titre", { name: token.name }), lines, { actor: token.actor, token }))
    ? moveTo(token, point, { action, level, forced: true }) : undefined;
  if ( !forced && isGrappled(token) ) return force([loc("Empoignade.Immobile", { name: token.name })]);
  // §218: Falling in the air — it falls first (damage included), the movement is redone once on the ground.
  if ( fallingAloft(token) ) { await fallNow(token); return; }
  const cell = cellUnder(token, point);
  // §18.26: a click on a staircase — go next to it, then enter it by walking: the core then asks to go up or down.
  const stairs = (!level || (level === token._source.level)) ? stairsEntry(token, cell) : null;
  const to = stairs ? { cells: stairs.around, level: stairs.level } : { cell, ...(level ? { level } : {}) };
  // §18.25: the path may go through a closed door — walk to it, open it, set off again (a few doors at most).
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, to, { maxCost: forced ? Infinity : movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return ui.notifications.warn(loc("Deplacement.AucunChemin"));
    if ( stairs && plan.arrives && !plan.door ) return enterStairs(token, plan, stairs, cell, action);
    if ( !plan.waypoints.length && !plan.door ) {
      if ( !plan.arrives && !forced ) return force([loc("Deplacement.Epuise")]);
      return;
    }
    if ( action ) plan.waypoints.forEach(w => { w.action = action; });
    if ( plan.waypoints.length && !(await walkSafely(token, plan, forced ? { forcedMove: true } : {})) ) return;
    // No door, or the turn's movement runs out before it: stop there.
    if ( !plan.door || !plan.arrives ) return;
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
}

/**
 * §39.1: public walk (`api.approach`), for modules that want a token to go somewhere by the engine's path
 * — A*, doors opened on the way, Opportunity Attacks, turn budget — without it knowing the module:
 * they give the permitted arrival cells (top-left corner of the token, on level `level` or its own), the engine goes to the
 * nearest one it reaches. Same loop as `moveTo`. No effect if the client does not own the token.
 * @param {TokenDocument} token
 * @param {{ cells: {i: number, j: number}[], level?: string|null }} to
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"noCells"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
export async function approach(token, { cells, level=null, target=null, reachCells=1, seeing=false }={}) {
  // §179: approach a target to a given reach or range (in cells), "while seeing it" if requested — the approach
  // zone of `planPath` (that of an attack), open to neighbors.
  if ( target ) return approachTarget(token, target, { reachCells, seeing });
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( !Array.isArray(cells) || !cells.length ) return { arrived: false, reason: "noCells" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const wanted = cells.map(({ i, j }) => ({ i, j }));
  const to = { cells: wanted, ...(level ? { level } : {}) };
  // Arrived: on one of the cells AND on the right level (§41.3: the same cell, one floor up, is not arrival).
  const onGoal = () => {
    if ( level && ((token._source.level ?? null) !== level) ) return false;
    const here = cellOf(token);
    return wanted.some(c => (c.i === here.i) && (c.j === here.j));
  };
  if ( onGoal() ) return { arrived: true };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, to, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return onGoal() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return onGoal() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return onGoal() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §179: walk toward a target to within `reachCells` cells of it (1 = in contact), on its level; `seeing`: only up to
 * a cell from which it is seen (a shooter). Doors, Opportunity Attacks and turn budget like any engine walk.
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
async function approachTarget(token, target, { reachCells=1, seeing=false }={}) {
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const reach = Math.max(1, Math.round(reachCells) || 1);
  // §192: in three dimensions — a target on the ceiling is not "in range" from the cell under it.
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null)) && (gapCells(token, target) <= reach);
  if ( there() ) return { arrived: true };
  // §192: out of reach by the vertical void alone (on the ceiling, in flight): no walk on the ground leads there, we do not move.
  if ( tooHighFor(token, target, { normal: reach }) ) return { arrived: false, reason: "tooHigh" };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, { target, reachCells: reach, seeing }, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return (there() || plan.arrives) ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return (there() || plan.arrives) ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return there() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §179: a path without walking it — toward cells (`cells`, `level`) or a target (`target`, `reachCells`, `seeing`). `maxCost`:
 * the cost ceiling to test (default: what remains to the token this turn, Infinity out of combat), in the grid's unit, added to
 * the turn's history; `extra`: a supplement to the turn ceiling (its Speed: "would it arrive by Dashing?"). Returns
 * `{ arrives, moves, door }` — `arrives`: the goal is reached within the ceiling —, or null if there is no path.
 */
export function pathTo(token, { cells=null, level=null, target=null, reachCells=1, seeing=false }={}, { maxCost=null, extra=0 }={}) {
  const doc = token?.document ?? token;
  if ( !doc?.object ) return null;
  const to = target ? { target: target.document ?? target, reachCells: Math.max(1, Math.round(reachCells) || 1), seeing }
    : { cells: (cells ?? []).map(({ i, j }) => ({ i, j })), ...(level ? { level } : {}) };
  if ( !target && !to.cells.length ) return null;
  const plan = planPath(doc, to, { maxCost: maxCost ?? (movementCap(doc) + (Number(extra) || 0)), throughDoors: true });
  if ( !plan ) return null;
  return { arrives: !!plan.arrives && !plan.door, moves: plan.waypoints.length > 0, door: !!plan.door };
}

/**
 * §41.3: join another token — go into contact, wherever it is on the scene (another level included), by the engine's
 * path: the approach zone of a target (`planPath` with `target`, as for a melee attack — a correct estimate,
 * where a list of cells around it exhausted the search from one level to another), doors opened on the way,
 * Opportunity Attacks, turn budget. `flags`: what the movement operation carries (`follow`, see `walkSafely`).
 * @returns {Promise<{ arrived: boolean, reason?: "notOwner"|"grappled"|"noPath"|"stopped"|"exhausted" }>}
 */
export async function joinToken(token, target, flags={}) {
  if ( !token?.isOwner ) return { arrived: false, reason: "notOwner" };
  if ( isGrappled(token) ) return { arrived: false, reason: "grappled" };
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null))
    && (footprintDistance(footprintOf(token), footprintOf(target)) <= 0);
  if ( there() ) return { arrived: true };
  for ( let opened = 0; opened <= MAX_DOORS_PER_MOVE; opened++ ) {
    const plan = planPath(token, { target, reachCells: 1 }, { maxCost: movementCap(token), throughDoors: opened < MAX_DOORS_PER_MOVE });
    if ( !plan ) return { arrived: false, reason: "noPath" };
    if ( !plan.waypoints.length && !plan.door ) return there() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( plan.waypoints.length && !(await walkSafely(token, plan, flags)) ) return { arrived: false, reason: "stopped" };
    if ( !plan.door ) return there() ? { arrived: true } : { arrived: false, reason: "exhausted" };
    if ( !plan.arrives ) return { arrived: false, reason: "exhausted" };
    await plan.door.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
  }
  return there() ? { arrived: true } : { arrived: false, reason: "noPath" };
}

/**
 * §41.3: redo a trip already made by another token (a leader's trail: its steps, level changes included),
 * without pathfinding — Opportunity Attacks and turn budget like any engine walk. Returns false if the
 * movement was refused or interrupted.
 */
export async function followTrail(token, waypoints, flags={}) {
  if ( !token?.isOwner || !waypoints?.length || isGrappled(token) ) return false;
  return walkSafely(token, { waypoints: waypoints.map(w => ({ ...w })), beyond: [], arrives: true }, flags);
}

/**
 * §18.26: walk to the cell next to the staircase, then one ordinary walking step into the staircase cell that
 * touches it (`stairs.entries`, adapter/movement.mjs `stairsEntry`) — not a `displace`, which would not trigger the core's
 * `changeLevel` behavior (change-level.mjs:57-62). The turn budget and Opportunity Attacks of this last step go
 * through `preMoveToken` like any movement.
 */
async function enterStairs(token, plan, stairs, cell, action) {
  if ( action ) plan.waypoints.forEach(w => { w.action = action; });
  if ( plan.waypoints.length && !(await walkSafely(token, plan)) ) return;
  const here = cellOf(token);
  const entry = stairs.entries?.get(`${here.i},${here.j}`) ?? cell;
  const step = { ...token.parent.grid.getTopLeftPoint(entry), snapped: true, ...(action ? { action } : {}) };
  await token.move([step], walkOptions());
}

/**
 * §41.2: take the staircase (ladder, elevator) under this point up to level `level`, in a single gesture — A* walks
 * to the side and puts the token on the staircase of the other level by a `displace` step (adapter/movement.mjs), without the
 * core's dialog; the height is counted against the turn budget, Opportunity Attacks played. The core does not change
 * a GM's view with their token (change-level.mjs:109): we do it here, like it.
 */
export async function takeStairs(token, point, level) {
  const origin = token._source.level;
  await moveTo(token, point, { level });
  if ( (token._source.level === level) && (origin !== level) && game.user.isGM && token.parent.isView && (canvas.level?.id === origin) ) {
    await token.parent.view({ level, controlledTokens: [token.id] });
  }
}

/** §18.25: doors that a single movement click opens on the way. */
const MAX_DOORS_PER_MOVE = 3;

/**
 * §208: jump to the aimed cell, in length (`high` false) or in height (`high` true: climb onto a higher surface — platform,
 * ledge —, within the high jump limit). Distances from the 2024 rules (core/jump.mjs): run-up read from the history in
 * combat, Athlete, Second-Story Work, Step of the Wind, and the fixed jump once per turn (Jump spell, Boots: 9 m for 3 m, the
 * difference returned to the budget). Each foot costs a foot (dnd5e: the "jump" mode with no multiplier or Difficult Terrain).
 * Arriving in Difficult Terrain: Dexterity (Acrobatics) check DC 10, otherwise Prone. A long jump keeps its height: if it arrives
 * above lower ground, dnd5e sets "Falling" and the fall follows (runtime/falls.mjs). On the jumper's client.
 */
export async function jumpTo(token, point, { high=false, configure=true, highOffered=false, forced=false }={}) {
  const grid = canvas.scene.grid;
  const units = grid.units;
  const cell = cellUnder(token, point);
  const top = grid.getTopLeftPoint(cell);
  const from = committedPosition(token);
  const ft = v => lengthIn(v, units, "ft");
  const toGrid = v => lengthIn(v, "ft", units);
  const horizontal = ft(grid.measurePath([grid.getCenterPoint(grid.getTopLeftPoint(cellOf(token))), grid.getCenterPoint(top)]).distance);
  const here = from.elevation ?? 0;
  const ground = groundUnder(token, { ...from, x: top.x, y: top.y });
  const rise = ft(ground - here);
  const options = jumpOptionsOf(token);
  const info = { rise, ground, horizontal, high: options.high, long: options.long, runningStart: options.runningStart };
  // A refusal: the message, and what the caller can read (reason, measurements).
  const refuse = (key, data) => { ui.notifications.warn(loc(key, data)); return { done: false, reason: key, ...info }; };
  // §412 (issue #44, batch 5): a rule limit (too high, too long, not enough movement) — the legality window; forced, the
  // same jump without these limits (`forced`), marked `forcedMove`, the GM notified. Waived: what the caller read from a refusal.
  const overLimit = async (key, data) => {
    if ( !(await askAnyway(loc("Saut.Titre", { name: token.name }), [loc(key, data)], { actor: token.actor, token })) ) return { done: false, reason: key, ...info };
    return jumpTo(token, point, { high, configure, highOffered, forced: true });
  };
  const fmt = n => `${Math.floor(toGrid(n) * 10) / 10} ${units}`;
  let elevation = here;
  let jump;
  if ( high ) {
    if ( rise <= 1e-6 ) return refuse("Saut.RienAMonter");
    // Height is jumped; horizontal movement, for its part, is paid separately.
    let up = jumpCost(rise, options.high, options.fixed);
    if ( !up.ok && !forced ) return overLimit("Saut.TropHaut", { max: fmt(up.limit), elan: loc(options.runningStart ? "Saut.AvecElan" : "Saut.SansElan") });
    if ( !up.ok ) up = { ok: true, cost: rise, fixed: null };
    jump = { ...up, cost: up.cost + horizontal, distance: rise + horizontal };
    elevation = ground;
  } else if ( (horizontal <= ft(grid.distance) + 1e-6) && (rise <= -ft(grid.distance) + 1e-6) ) {
    // §219: a step into the void — the neighboring cell is lower by at least one cell (from a roof edge, from a floor toward the
    // yard): one throws oneself in without jumping (no jump limit, no Boots), at the cost of one cell of movement,
    // and the fall follows (damage included).
    jump = { ok: true, cost: horizontal, distance: horizontal, fixed: null, stepOff: true };
  } else {
    // The "Jump high here" entry is only offered if the world setting displays it (beta): the refusal is only returned then.
    if ( rise > 1e-6 ) return refuse(highOffered ? "Saut.PlusHaut" : "Saut.PlusHautSansMenu");
    jump = { ...jumpCost(horizontal, options.long, options.fixed), distance: horizontal };
    if ( !jump.ok && !forced ) return overLimit("Saut.TropLong", { max: fmt(jump.limit), elan: loc(options.runningStart ? "Saut.AvecElan" : "Saut.SansElan") });
    if ( !jump.ok ) jump = { ok: true, cost: horizontal, distance: horizontal, fixed: null };
  }
  // The movement that remains this turn (the same count as the interface ring: engine ceiling minus the core's history).
  if ( options.combatant ) {
    const { spent, excluded } = historyCosts(token);
    const left = movementCap(token) - spent - excluded;
    if ( !forced && (toGrid(jump.cost) > left + 1e-6) ) return overLimit("Saut.PasAssez", { cost: fmt(jump.cost), left: `${Math.floor(left * 10) / 10} ${units}` });
  }
  // Fixed jump: the core will count the whole distance; the difference is returned, and the fixed jump is taken for the turn.
  const refund = (jump.fixed && options.combatant) ? Math.max(0, toGrid(jump.distance - jump.cost)) : 0;
  if ( jump.fixed && options.combatant ) {
    const b = readBudget(options.combatant);
    await writeBudget(options.combatant, { ...b, fixedJump: true, jumped: (Number(b.jumped) || 0) + refund });
  }
  const dest = { ...top, elevation, snapped: true, action: "jump" };
  // High jump: rise first on the spot, then advance at that height — in a straight line from the ground, the trajectory passed
  // under the edge of the aimed surface, which the core treats as solid from below (the movement was refused).
  const rising = high ? [{ x: from.x, y: from.y, elevation, snapped: true, action: "jump" }] : [];
  // §219: toward lower by at least one cell, from an open-air roof — over the "guardrail" that level maps place at the
  // edge of roofs (Restored Keep: the edge wall belongs to the stable roof, on Second Floor).
  // From a covered room, its walls stop it.
  const overWalls = !high && (rise <= -ft(grid.distance) + 1e-6) && !Number.isFinite(boundsUnder(token, from).ceiling);
  const moved = await walkSafely(token, { waypoints: [...rising, dest], beyond: [], arrives: true }, { ...(overWalls ? { overWalls: true } : {}), ...(forced ? { forcedMove: true } : {}) });
  if ( (moved === false) && jump.fixed && options.combatant ) {
    const b = readBudget(options.combatant);
    await writeBudget(options.combatant, { ...b, fixedJump: false, jumped: Math.max(0, (Number(b.jumped) || 0) - refund) });
    return { done: false, reason: "moveRefused", ...info };
  }
  if ( (moved === false) && jump.stepOff ) return { done: false, reason: "moveRefused", ...info };
  log(jump.stepOff ? `${token.name}: steps off the edge (${Math.round(-rise)} ft drop)`
    : `${token.name}: ${high ? "high" : "long"} jump, ${Math.round(jump.distance)} ft for ${Math.round(jump.cost)} ft${jump.fixed ? " (fixed jump)" : ""}${options.runningStart ? "" : ", standing"}`);
  // §218: landed above the void (jumped from a roof, from a floor toward the yard) — the fall follows at once, in combat or out,
  // from one level to another, damage included (dnd5e's fall).
  if ( (token._source.elevation ?? 0) > groundUnder(token) + 1e-6 ) {
    log(`${token.name}: lands over a drop — falls`);
    if ( await fallNow(token) ) return { done: true, reason: null, fell: true, stepOff: !!jump.stepOff, fixed: jump.fixed, cost: jump.cost, ...info };
  }
  // Arriving in Difficult Terrain: Dexterity (Acrobatics) DC 10, otherwise Prone.
  const center = { x: top.x + ((token.width ?? 1) * grid.sizeX / 2), y: top.y + ((token.height ?? 1) * grid.sizeY / 2) };
  if ( landsOnDifficult(token, center, elevation) ) {
    ui.notifications.info(loc("Saut.Atterrissage", { name: token.name, dc: LANDING_DC }));
    // §252: the fall waits for the 3D dice to finish, then is seen and heard by everyone.
    const rolls = await rolledAndShown(() => token.actor.rollSkill({ skill: "acr", ability: "dex", target: LANDING_DC }, { configure }));
    const total = rolls?.[0]?.total;
    if ( Number.isFinite(total) && (total < LANDING_DC) ) {
      await token.actor.toggleStatusEffect("prone", { active: true });
      notice(token, { key: "Saut.ATerre" }, "refused", { all: true, action: "land", outcome: "failure" });
    } else if ( Number.isFinite(total) ) notice(token, { key: "Retour.Action.Retombe" }, "gain", { all: true, action: "land", outcome: "success" });
  }
  return { done: moved !== false, reason: null, fixed: jump.fixed, cost: jump.cost, ...info };
}

/**
 * §18.24: the cells from which a token touches a door, on its side of the wall (the opposite side if it is exactly on it: both).
 * Along the wall, one cell per grid step, offset by half a footprint perpendicularly.
 */
function doorSideCells(token, wall) {
  const grid = token.parent.grid;
  const [x1, y1, x2, y2] = wall.document.c;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if ( !length ) return [];
  const dir = { x: (x2 - x1) / length, y: (y2 - y1) / length };
  const normal = { x: -dir.y, y: dir.x };
  const center = tokenCenter(token);
  const side = Math.sign((normal.x * (center.x - x1)) + (normal.y * (center.y - y1)));
  const { w, h } = sizeOf(token);
  const offset = (Math.max(w, h) * grid.size) / 2;
  const steps = [];
  for ( let t = grid.size / 2; t < length; t += grid.size ) steps.push(t);
  if ( !steps.length ) steps.push(length / 2);
  const cells = new Map();
  for ( const s of side ? [side] : [1, -1] ) {
    for ( const t of steps ) {
      const point = { x: x1 + (dir.x * t) + (normal.x * s * offset), y: y1 + (dir.y * t) + (normal.y * s * offset) };
      const cell = cellUnder(token, point);
      cells.set(`${cell.i},${cell.j}`, cell);
    }
  }
  return Array.from(cells.values());
}

/**
 * §18.24: move up to a door before acting on it (open, close, pick, force). Like a contact gesture
 * (§18.22), one only moves if one gets there this turn. true: in contact (or a grid with no cells, where one acts on the spot).
 */
export async function approachDoor(token, wall, { forced=false }={}) {
  const grid = token.parent.grid;
  if ( grid.isGridless || !grid.isSquare ) return true;
  const cells = doorSideCells(token, wall);
  if ( !cells.length ) return true;
  const here = cellOf(token);
  if ( cells.some(c => (c.i === here.i) && (c.j === here.j)) ) return true;
  // §412 (issue #44, batch 5): Grappled, out of reach this turn — the legality window; forced, the path with no ceiling
  // (`forcedMove`).
  const force = async line => (await askAnyway(loc("Deplacement.Titre", { name: token.name }), [line], { actor: token.actor, token }))
    && approachDoor(token, wall, { forced: true });
  if ( !forced && isGrappled(token) ) return force(loc("Empoignade.Immobile", { name: token.name }));
  const plan = planPath(token, { cells, level: token._source.level ?? undefined }, { maxCost: forced ? Infinity : movementCap(token) });
  if ( !plan ) { ui.notifications.warn(loc("Deplacement.AucunChemin")); return false; }
  if ( !plan.arrives && !forced ) return force(loc("Porte.HorsDatteinte"));
  if ( !plan.waypoints.length ) return true;
  if ( !(await walkSafely(token, plan, forced ? { forcedMove: true } : {})) ) return false;
  // Stopped along the way (Opportunity Attack that knocks down, core constraint): one does not act from a distance.
  const at = cellOf(token);
  return cells.some(c => (c.i === at.i) && (c.j === at.j));
}

/**
 * §16.59: walk until `gap` cells from `anchor` (0: in contact — Approach; more: Flee), by the engine's A*,
 * within the turn budget, step by step (Opportunity Attacks included). Out of reach: as close as possible.
 * Returns true if the token arrived at that gap.
 */
export async function walkToGap(token, anchor, gap, { maxCost=null }={}) {
  const grid = token.parent.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  const cells = cellsAtGap(footprintOf(anchor), sizeOf(token), gap, bounds);
  if ( !cells.length || isGrappled(token) ) return false;
  // §147: `maxCost` — a movement outside the turn budget (the Dissonant Whispers Reaction: the whole Speed).
  const plan = planPath(token, { cells, level: token._source.level ?? undefined }, { maxCost: maxCost ?? movementCap(token) });
  if ( plan?.waypoints?.length ) await walkSafely(token, plan);
  return footprintDistance(footprintOf(token), footprintOf(anchor)) === gap;
}

/** Current ground gap, in cells, between two tokens (0: in contact) — in two dimensions: the flight (§180) is measured on the map. */
export const gapBetween = (a, b) => Math.max(0, footprintDistance(footprintOf(a), footprintOf(b)));

/**
 * §180: move away from a threat (a neighbor: an NPC's flight). "As far as the turn's movement allows" — plus `extra`
 * (the Speed: a Dash taken first) —, by the engine's A* and its walk (Opportunity Attacks, budget). The gaps are tried
 * from farthest to nearest (`fleeGaps`, like Dissonant Whispers §147). `dryRun`: only say whether a greater gap is
 * reachable, without moving. Returns `{ moved, from, to, reason? }`
 * (`reason`: `notOwner` | `grappled` | `noMovement` | `cornered`).
 */
export async function fleeFrom(token, anchor, { extra=0, dryRun=false }={}) {
  token = token?.document ?? token;
  anchor = anchor?.document ?? anchor;
  if ( !token?.isOwner ) return { moved: false, reason: "notOwner" };
  const from = gapBetween(token, anchor);
  if ( isGrappled(token) ) return { moved: false, from, to: from, reason: "grappled" };
  const distance = token.parent.grid.distance || 5;
  const cap = movementCap(token);
  const history = historyCosts(token);
  const speed = speedOf(token.actor, readUnitFactors(), token._source?.movementAction ?? null, token.parent)?.speed ?? 0;   // §229 : vol, nage…
  const left = Number.isFinite(cap) ? (cap - history.spent - history.excluded) : speed;
  const maxCost = (Number.isFinite(cap) ? cap : (history.spent + history.excluded + speed)) + (Number(extra) || 0);
  const cells = Math.floor((Math.max(0, left) + (Number(extra) || 0)) / distance);
  if ( cells <= 0 ) return { moved: false, from, to: from, reason: "noMovement" };
  const grid = token.parent.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = token.parent.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  for ( const gap of fleeGaps(from, cells) ) {
    const goal = cellsAtGap(footprintOf(anchor), sizeOf(token), gap, bounds);
    if ( !goal.length ) continue;
    const plan = planPath(token, { cells: goal, level: token._source.level ?? undefined }, { maxCost });
    if ( !plan?.arrives || !plan.waypoints?.length ) continue;
    if ( dryRun ) return { moved: false, from, to: gap, possible: true };
    await walkSafely(token, plan);
    const to = gapBetween(token, anchor);
    return { moved: to !== from, from, to };
  }
  return { moved: false, from, to: from, reason: "cornered" };
}

/** Attack mode imposed by a click ("throw"), read at the attack roll (runtime/turn.mjs). Short-lived. */
const pendingAttacks = new Map();

/**
 * A use replayed by a gate (runtime/gates.mjs) keeps what had been decided: roll with no dialog, mode,
 * and the confirmation already given ("Attack anyway" at use) — otherwise the roll's range check
 * would ask again, with no timer (seen on 2026-09-24: "Wizard is out of range" after a Sanctuary gate).
 */
export function keepPendingAttack(activity, { mode=null, fast=false, confirmed=false }={}) {
  pendingAttacks.set(activity.uuid, { mode, fast, confirmed, at: Date.now() });
}

export function takePendingAttack(activity) {
  const entry = pendingAttacks.get(activity.uuid);
  pendingAttacks.delete(activity.uuid);
  return (entry && ((Date.now() - entry.at) < 30000)) ? entry : null;
}

/**
 * Designates the target, approaches if needed, then uses the activity: the rolls come after
 * the movement. If the turn does not allow arriving within range, one advances and stops there.
 * @param {TokenDocument} token
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {string|null} [options.mode]   Attack mode imposed ("thrown").
 * @param {boolean} [options.fast]       Attack roll with no dialog.
 * @param {Array} [options.usage]        [usageConfig, dialogConfig, messageConfig] of a suspended use (aiming).
 * @param {string} [options.choice]      Exclusive effect chosen in advance (activity effect id): the question
 *                                       about the effect will not be asked (§15.2, "Grapple", "Shove: Prone").
 * @param {Event} [options.event]        The click that launched the action: dnd5e reads the Advantage and
 *                                       Disadvantage keys there (Alt / Ctrl, dice/d20-roll.mjs:83-84); it goes to the roll through
 *                                       `usageConfig.event` (activity/attack.mjs:69). No effect if the suspended
 *                                       use already carries its own.
 */
/**
 * §16.29 (user decision, 2026-09-25): only a melee attack approaches its target (click on an
 * enemy: advance then strike) — and a piloted object, which acts in contact. A spell, a ranged or thrown weapon never
 * moves the creature: out of range, the click is refused.
 */
export function approaches(activity, mode=null) {
  if ( pilotOfActor(activity?.actor) ) return true;
  if ( contactAction(activity) ) return true;
  const thrown = String(mode ?? "").includes("thrown");
  return (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !thrown;
}

/**
 * §18.22: the contact gestures of the basic actions — unarmed attack, Grapple / Shove, Help. They approach
 * their target like a melee attack, but only if it is valid and reachable this turn: otherwise,
 * we do not move.
 */
export function contactAction(activity) {
  const item = activity?.item;
  return (!!item && (identifierOf(item).id === "unarmed-strike")) || (basicActionOf(item) === "help");
}

/**
 * Why a contact gesture does not hold against this target (short text), or null. Help: an enemy; Grapple /
 * Shove: a creature at most one size larger than oneself (2024 Player's Handbook, unarmed strike).
 */
export function contactRefusal(token, target, activity) {
  if ( !contactAction(activity) ) return null;
  if ( target === token ) return loc("Retour.PasSoi");
  if ( (basicActionOf(activity.item) === "help") && !hostileTo(token, target) ) return loc("Retour.PasEnnemi");
  // §281 : `grappleSize.bonus` — l'auteur compte comme plus grand pour Agripper et Pousser (Poids lourd).
  if ( (activity.type === "save") && (sizeRankOf(target.actor) > sizeRankOf(token.actor) + 1 + grappleRulesOf(token.actor).bonus) ) return loc("Retour.TropGrand");
  return null;
}

/**
 * Where a target stands for an activity that does not approach: `out` beyond long range, `blind` within range of a
 * ranged weapon or a spell but without line of sight. null: no range to hold.
 * Issue #42 (continued): line of sight WITHOUT the edges of Darkness sources (`throughDarkness`) — walls and floors only.
 * Seeing the target is `canSee`'s business (Devil's Sight, hearing at Disadvantage); the edges of Darkness refused any target
 * inside or behind, "forbidden" cursor, even to the warlock who saw it.
 */
export function rangeStatus(token, target, activity, mode=null) {
  const reach = reachCells(activity, mode);
  if ( !reach ) return null;
  const gap = gapCells(token, target);   // §192: in three dimensions (a target on the ceiling is out of reach)
  const out = gap > reach.long;
  const blind = !out && (reach.normal > 1) && !hasLineOfSight(tokenCenter(token), target, undefined, { throughDarkness: true, externalRadius: token.object?.externalRadius ?? 0 });
  return { out, blind, gap, reach };
}

/**
 * §67: a reaction that first joins the source ("move up to your Speed toward the attacker and attack it").
 * Out of the activity's reach, the reactor approaches — its whole Speed, whatever it spent on its turn (the
 * reaction gives this movement), with no Opportunity Attack (`cleared`, like a forced movement). Out of combat, no
 * budget to read: the Speed alone. Returns true if the target is then within range.
 * @param {Actor5e} actor            The one reacting.
 * @param {TokenDocument} target     The window's source.
 * @param {Activity} activity        The reaction activity.
 */
export async function reactionApproach(actor, target, activity) {
  const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  const reach = reachCells(activity);
  if ( !token?.isOwner || !target || !reach ) return false;
  if ( gapCells(token, target) <= reach.normal ) return true;
  if ( tooHighFor(token, target, reach) ) return false;   // §192: on the ceiling, out of reach — no moving for nothing
  // Out of combat (no turn budget), the Speed alone, counted from the core's history as it is.
  const combatant = combatantFor(actor);
  const movement = combatant ? movementOf(combatant, readUnitFactors())
    : { spent: historyCosts(token).spent, ...(speedOf(actor, readUnitFactors(), token._source?.movementAction ?? null, token.parent) ?? { speed: 0 }) };
  if ( !(movement?.speed > 0) || isGrappled(token) ) return false;
  // The ceiling is compared with the core's history (this turn): what is already done, plus the Speed the reaction gives.
  const maxCost = movement.spent + movement.speed + historyCosts(token).excluded;
  const plan = planPath(token, { target, reachCells: reach.normal }, { maxCost });
  if ( !plan?.waypoints.length ) return false;
  await walk(token, plan, { cleared: true });
  log(`${token.name}: moves to ${target.name} for its reaction (${activity.item?.name ?? ""})${plan.arrives ? "" : ", without reaching it"}`);
  return !!plan.arrives;
}

export async function engage(token, target, activity, { mode=null, fast=false, usage=null, event=null, choice=null, issues=[] }={}) {
  // §150: the mode a neighbor put in the use configuration (`{ "dnd5e-combat": { attackMode } }`: the Bar's off-hand
  // attack) — without it, it was lost between aiming and the roll.
  mode ??= usage?.[0]?.[MODULE_ID]?.attackMode ?? null;
  // §411 (issue #44, batch 4): a refusal is no longer flat. What is wrong is said in the legality window (runtime/turn.mjs,
  // `issues`), as for the same attack launched from the sheet; forced, one attacks from where one is, without approaching.
  // `coverRange`: the reason already states the range (legality does not repeat it).
  const lines = [...issues];
  let coverRange = false;
  const refuse = (line, { range=true }={}) => { lines.push(line); if ( range ) coverRange = true; };
  // §18.22: a contact gesture on a target that does not lend itself to it; §225: from one plane to another
  // (legality says so: `otherPlane`).
  const contact = contactRefusal(token, target, activity);
  if ( contact ) refuse(loc("LabelValue", { label: target.name, value: contact }), { range: false });
  const otherPlane = !!planeRefusal(token, target);
  // Outside melee, one does not move: out of range (legality says so), or out of sight.
  if ( !approaches(activity, mode) ) {
    const status = rangeStatus(token, target, activity, mode);
    if ( status?.blind ) refuse(loc("Souci.noLineOfSight", { name: target.name }), { range: false });
  }
  // §16.15: a piloted object acts in contact — the range of "Roll" (9 m) is that of its movement, not of its effect.
  const reach = pilotOfActor(activity.actor) ? { normal: 1, long: 1 } : reachCells(activity, mode);
  // §192: a target that the vertical void alone puts out of reach (on the ceiling, in flight) —
  // the ground approach does not lead there.
  const tooHigh = !!reach && approaches(activity, mode) && tooHighFor(token, target, reach);
  if ( tooHigh ) refuse(loc("Escalade.HorsDallonge", { name: target.name }));
  target.object?.setTarget(true, { releaseOthers: true });
  // A target refused outright (contact, other plane, too high): no approach for nothing.
  if ( reach && approaches(activity, mode) && !tooHigh && !contact && !otherPlane ) {
    const gap = gapCells(token, target);
    // P1: at range, one only approaches to a cell from which one SEES the target — and if one is
    // already within range without seeing it, one looks for such a cell.
    const ranged = reach.normal > 1;
    const seeing = ranged;
    const blind = ranged && (gap <= reach.normal) && !hasLineOfSight(tokenCenter(token), target, undefined, { throughDarkness: true, externalRadius: token.object?.externalRadius ?? 0 });   // issue #42 : comme `rangeStatus`
    if ( (gap > reach.normal) || blind ) {
      const plan = planPath(token, { target, reachCells: reach.normal, seeing }, { maxCost: movementCap(token) });
      const withinLong = !blind && (gap <= reach.long);
      if ( !plan && blind ) refuse(loc("Deplacement.CibleHorsDeVue", { name: target.name }));
      else if ( !plan && !withinLong ) refuse(loc("Deplacement.AucunChemin"));
      // §18.22: a contact gesture does not advance for nothing — out of reach this turn, one stays in place.
      else if ( contactAction(activity) && !plan?.arrives && !withinLong ) refuse(loc("Deplacement.CibleHorsDatteinte", { name: target.name }));
      else if ( plan?.arrives || !withinLong ) {
        if ( plan && !(await walkSafely(token, plan)) ) return;
        if ( !plan?.arrives ) refuse(loc("Deplacement.CibleHorsDatteinte", { name: target.name }));
      }
    }
  }
  pendingAttacks.set(activity.uuid, { mode, fast, at: Date.now() });
  const [usageConfig, dialogConfig, original] = usage ?? [{}, {}, {}];
  // dnd5e freezes the targets in the message configuration from the first use
  // (activity/mixin.mjs:239-242): at that moment there were none. We let them be read again.
  const messageConfig = foundry.utils.deepClone(original ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  // The mode chosen by the click ("throw", "off-hand"): legality reads it at use, the
  // budget on the card (runtime/turn.mjs) — the off-hand attack costs the Bonus Action, not the action.
  if ( mode ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.attackMode`, mode);
  if ( choice ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.choice`, choice);
  const config = { ...usageConfig, [MODULE_ID]: { ...usageConfig?.[MODULE_ID], engaged: true, ...(mode ? { attackMode: mode } : {}), ...(choice ? { choice } : {}),
    ...(lines.length ? { issues: mergeIssues(usageConfig?.[MODULE_ID]?.issues ?? [], lines), issuesCoverRange: coverRange || !!usageConfig?.[MODULE_ID]?.issuesCoverRange } : {}) } };
  if ( event && !config.event ) config.event = event;
  // §436: under the `antimagic` status, dnd5e would flatly refuse a spell — the engine's window first, forceable.
  await useDespiteAntimagic(activity, extra => activity.use({ ...config, [MODULE_ID]: { ...config[MODULE_ID], ...extra } }, dialogConfig, messageConfig),
    { forced: !!config[MODULE_ID].antimagicForced });
}

/**
 * §16.33: intent "cast on these creatures" (group aim, ui/pointer.mjs) — the suspended use restarts, with the
 * level already chosen, with the designated creatures as targets. dnd5e freezes the card's targets from the first use
 * (activity/mixin.mjs:239-242): we let them be re-read.
 * @param {Activity} activity
 * @param {[object, object, object]} usage  Use, dialog and message configurations.
 * @param {string[]} picks                  UUIDs of the tokens.
 */
export async function castOnTargets(activity, [config, dialog, message], picks) {
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  for ( const uuid of picks ) fromUuidSync(uuid, { strict: false })?.object?.setTarget(true, { releaseOthers: false, groupSelection: true });
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  await useDespiteAntimagic(activity, extra => activity.use({ ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), engaged: true, ...extra } },
    dialog, messageConfig), { forced: !!config?.[MODULE_ID]?.antimagicForced });
}

/* -------------------------------------------- */

export function registerActions() {
  route("dnd5e.teleport", onTeleport, { cancellable: true, label: "teleport: destination" });
  route("dnd5e.postUseActivity", onDashUsed, { label: "straight-line dash: movement" });
  route("dnd5e.preCreateMeasuredTemplate", onDashTemplate, { cancellable: true, label: "straight-line dash: no area" });
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "movement: cap and opportunity attacks" });
  route("moveToken", (token, movement) => noteWindward(token, movement), { executor: true, label: "Gust of Wind: extra cost not counted" });
  // §99: the pause stops the engine's walks launched from this client (each stops its own, Hooks.callAll everywhere).
  route("pauseGame", paused => { if ( paused ) stopAllWalks(); }, { label: "pause: walks stopped" });
}
