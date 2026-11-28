/**
 * Movement cap for players (`preMoveToken`): turn budget, Opportunity Attacks before the step, leashes of
 * piloted objects. Extracted from runtime/actions.mjs.
 */

import { barrierCrossed } from "../adapter/barriers.mjs";
import { isEthereal, etherealWallBetween } from "../adapter/plane.mjs";
import { MODULE_ID } from "../constants.mjs";
import { combatantFor, distanceBetween, positionOf, readBudget, writeBudget } from "../adapter/turn.mjs";
import { pilotOf, summonerToken, groupTokens } from "../adapter/pilot.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { continuedFlags, walkOptions } from "../adapter/movement.mjs";
import { fearSources, leashesOf } from "../adapter/conditions.mjs";
import { movesCloser } from "../core/conditions.mjs";
import { opportunityThreats, resolveOpportunity, splitForReady } from "./reactions.mjs";
import { scatterStop } from "./scatter.mjs";
import { levelAtLeast } from "./levels.mjs";
import { loc, log } from "./shared.mjs";
import { askAnyway } from "./turn.mjs";
import { forcedKey } from "../core/forced.mjs";
import { windwardCost } from "../adapter/windward.mjs";
import { isGrappled, movementCap, occupiedAt, pilotMove } from "./actions.mjs";

/* -------------------------------------------- */
/*  Movement cap (players)                      */
/* -------------------------------------------- */

/**
 * A player does not exceed their turn's movement and does not end on a taken cell, whatever
 * the way of moving (click, drag, keyboard). The GM is never held back.
 */
export function onPreMoveToken(token, movement, operation) {
  if ( !token.actor ) return true;
  // §412 (issue #44, batch 5): a rule refusal is no longer dry. The movement is suspended (`preMoveToken` is synchronous), the
  // legality window says why on the mover's side; forced, the same path restarts marked `forcedMove` (these rules do not rejudge
  // it: Opportunity Attacks and caltrops, yes), the GM and the table notified.
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement);
  if ( !flags?.forcedMove ) {
    const issues = moveIssues(token, movement);
    if ( issues.length ) {
      askToForceMove(token, movement, issues).catch(err => console.error(`${MODULE_ID} | forced movement`, err));
      return false;
    }
  }
  // §187: caltrops, ball bearings — whoever enters stops on their first cell (the rest of the path is not played).
  if ( !scatterStop(token, movement, operation) ) return false;
  // §117: Opportunity Attacks are a general rule — Assisted level and above; at Essential level, we walk.
  return levelAtLeast("assisted") ? opportunityFirst(token, movement, operation) : true;
}

/**
 * §412: what holds back this movement — `[{ key, line }]` (stable key, window sentence). §163 Antilife Shell (GM included: it
 * pushes back their creatures), §225 Wall of Force in the Ethereal Plane, §402 leash (GM included: it is the creature that is
 * held); for a player only (the GM is never held back): Frightened, piloted object too alone / too far / out of its turn, taken
 * cell, Grappled, turn movement used up.
 */
export function moveIssues(token, movement) {
  const issues = [];
  // §163: teleportation and forced movement (`displace`): not a walk. §225: the whole path — a one-piece movement (drag, keyboard)
  // has nothing in `pending`, everything is in `passed` (seen in play); only `pending` was read, so a drag entered the Shell.
  const steps = [...movement.passed.waypoints, ...movement.pending.waypoints]
    .filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  const fence = steps.length ? barrierCrossed(token, steps.map(w => positionOf(w))) : null;
  if ( fence ) issues.push({ key: "barrier", line: loc("Deplacement.Barriere", { name: token.name, item: fence.item.name }) });
  // §225, batch 3: in the Ethereal Plane, walls are crossed (action "ethereal", `walls: null`), except those that stop ethereal
  // travel (Wall of Force, Forcecage) — GM included.
  if ( steps.length && isEthereal(token) ) {
    const origin = movement.origin ?? token._source;
    const centers = [origin, ...steps].map(p => token.getCenterPoint({ ...token._source, ...p }));
    if ( centers.some((c, i) => (i > 0) && etherealWallBetween(token.parent, centers[i - 1], c, token._source.level)) ) {
      issues.push({ key: "forceWall", line: loc("Ethere.MurDeForce", { name: token.name }) });
    }
  }
  // §402: a leash (Compelled Duel) — no voluntary step beyond its distance from the caster.
  const held = steps.length ? leashBroken(token, steps) : null;
  if ( held ) issues.push({ key: "leash", line: loc("Deplacement.Laisse", { name: token.name, source: held.source.name, item: held.item.name }) });
  if ( !game.user.isGM ) issues.push(...playerIssues(token, movement));
  return issues;
}

/** Memory of forced refusals, per token and reasons: a keyboard path (one step per key) does not ask the same thing again (60 s). */
const forcedMoves = new Map();
const FORCED_MOVE_MS = 60000;

/**
 * §412: a movement refusal from another checkpoint (`preMoveToken` of the climb) — the same window, the same relaunch.
 * Synchronous for the caller: it returns `false` at once.
 */
export function forceMoveLater(token, movement, issues) {
  askToForceMove(token, movement, issues).catch(err => console.error(`${MODULE_ID} | forced movement`, err));
}

/** §412: "Do it anyway"? Forced: the same path restarts marked `forcedMove` (and `ignoreTokens` for a taken cell). */
async function askToForceMove(token, movement, issues) {
  const memo = `${token.uuid}|${forcedKey(issues.map(i => i.key))}`;
  const remembered = (Date.now() - (forcedMoves.get(memo) ?? 0)) < FORCED_MOVE_MS;
  if ( !remembered ) {
    const go = await askAnyway(loc("Deplacement.Titre", { name: token.name }), issues.map(i => i.line), { actor: token.actor, token });
    if ( !go ) return;
    forcedMoves.set(memo, Date.now());
  }
  const waypoints = [...movement.passed.waypoints, ...movement.pending.waypoints].map(({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
    ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }));
  const occupied = issues.some(i => i.key === "occupied");
  await token.move(waypoints, { ...walkOptions(movement), ...(occupied ? { constrainOptions: { ignoreTokens: true } } : {}), [MODULE_ID]: { forcedMove: true } });
}

/**
 * Opportunity Attacks are settled BEFORE the movement: if there are any, the movement is
 * suspended (`preMoveToken` is synchronous), the attacks are played, then the same movement
 * restarts, marked as already checked. Applies to click, drag and keyboard, GM included.
 */
function opportunityFirst(token, movement, operation) {
  // §99: a piece of the engine's walk that the core chains itself no longer has the engine's options — it is already checked.
  if ( (operation?.[MODULE_ID] ?? continuedFlags(token, movement))?.cleared ) return true;
  const waypoints = [...movement.passed.waypoints, ...movement.pending.waypoints];
  const threats = opportunityThreats(token, waypoints, { explain: true });
  if ( !threats.length ) return true;
  (async () => {
    // §211: a readied action triggered en route — the token goes up to the cell where it comes in range, the action is
    // offered, then the rest restarts as a new movement (its threats reviewed from there).
    const split = splitForReady(token, waypoints, threats);
    if ( split ) {
      if ( !(await resolveOpportunity(token, split.before)) ) return;
      if ( split.first.length ) {
        await token.move(split.first, { ...walkOptions(movement), [MODULE_ID]: { cleared: true } });
        const animation = token.object?.movementAnimationPromise;
        if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, 10000))]);
      }
      if ( !(await resolveOpportunity(token, [split.ready])) ) return;
      if ( split.rest.length ) await token.move(split.rest, walkOptions(movement));
      return;
    }
    if ( !(await resolveOpportunity(token, threats)) ) return;
    const again = waypoints.map(({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
      ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }));
    await token.move(again, { ...walkOptions(movement), [MODULE_ID]: { cleared: true } });
  })().catch(err => console.error(`${MODULE_ID} | opportunity attack before movement`, err));
  return false;
}

/**
 * §17.3: Frightened — "you can't willingly move closer to the source of your fear". A forced movement
 * or a teleportation (`displace`, actions `teleport`) is not voluntary in the engine's sense: it passes.
 */
function approachesFear(token, movement) {
  if ( !token.actor?.statuses?.has("frightened") ) return null;
  // The whole path, as for barriers (§225): a drag or a keyboard step has nothing in `pending`, everything is in `passed`.
  const steps = [...movement.passed.waypoints, ...movement.pending.waypoints]
    .filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  if ( !steps.length ) return null;
  for ( const source of fearSources(token) ) {
    const start = distanceBetween(token, source).value;
    if ( movesCloser(start, steps.map(w => distanceBetween(token, source, { posA: positionOf(w) }).value)) ) return source;
  }
  return null;
}

/** §402: the leash that this path exceeds (a cell beyond the distance, farther than at the start), or null. */
function leashBroken(token, steps) {
  for ( const leash of leashesOf(token) ) {
    const limit = lengthIn(leash.distance, leash.units, token.parent.grid.units);
    const start = distanceBetween(token, leash.source).value;
    const far = steps.some(w => {
      const d = distanceBetween(token, leash.source, { posA: positionOf(w) }).value;
      return (d > limit + 1e-6) && (d > start + 1e-6);
    });
    if ( far ) return leash;
  }
  return null;
}

function playerIssues(token, movement) {
  const issues = [];
  const fear = approachesFear(token, movement);
  if ( fear ) issues.push({ key: "frightened", line: loc("Deplacement.Effraye", { name: token.name, source: fear.name }) });
  // "A light must stay within 6 m of another" (`cluster`, §16.17) also applies to a `displace` step (the A* staircase).
  const pilot = pilotOf(token);
  if ( pilot?.rule.cluster && !nearAnother(token, pilot, movement.destination) ) {
    issues.push({ key: "cluster", line: loc("Pilote.TropSeul", { name: token.name, max: pilot.rule.cluster.distance, units: pilot.rule.cluster.units }) });
  }
  if ( pilot?.rule.tether && !withinTether(token, pilot, movement.destination) ) {
    issues.push({ key: "tether", line: loc("Pilote.TropLoinLanceur", { name: token.name, summoner: pilot.summoner.name, max: pilot.rule.tether.distance, units: pilot.rule.tether.units }) });
  }
  const last = movement.passed.waypoints.at(-1) ?? movement.destination;
  if ( CONFIG.Token.movement.actions[last?.action]?.teleport ) return issues;
  if ( occupiedAt(token, movement.destination) ) issues.push({ key: "occupied", line: loc("Deplacement.CaseOccupee") });
  if ( isGrappled(token) ) issues.push({ key: "grappled", line: loc("Empoignade.Immobile", { name: token.name }) });
  if ( pilot ) return [...issues, ...pilotIssues(token, movement, pilot)];
  if ( !combatantFor(token.actor) ) return issues;
  const allowance = movementCap(token);
  // §403: Gust of Wind — toward the caster in the Line, each meter costs two (extra cost of steps already made is in the budget).
  const total = movement.history.cost + movement.passed.cost + movement.pending.cost
    + windwardCost(token, movement.origin ?? token._source, [...movement.passed.waypoints, ...movement.pending.waypoints]);
  if ( total > allowance + 1e-6 ) issues.push({ key: "exhausted", line: loc("Deplacement.Epuise") });
  return issues;
}

/**
 * §403: Gust of Wind — after a step, the active GM adds to the turn budget (`windward`) the extra cost of what was covered
 * toward the caster in the Line; `movementCap` subtracts it from the cap. Teleportation and forced movement: not a walk.
 */
export async function noteWindward(token, movement) {
  const combatant = token?.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return;
  const steps = (movement?.passed?.waypoints ?? []).filter(w => !CONFIG.Token.movement.actions[w.action]?.teleport && (w.action !== "displace"));
  const extra = steps.length ? windwardCost(token, movement.origin, steps) : 0;
  if ( !(extra > 0) ) return;
  const budget = readBudget(combatant);
  await writeBudget(combatant, { ...budget, windward: (Number(budget.windward) || 0) + extra });
  log(`${token.name}: ${extra} more movement spent against the wind`);
}

/** §16.15: a piloted object only moves on its caster's turn, within the distance of a command it can pay for. */
function pilotIssues(token, movement, pilot) {
  const { cap, issue } = pilotMove(token, pilot);
  const names = { name: token.name, summoner: pilot.summoner.name };
  if ( issue ) return [{ key: `pilot.${issue}`, line: loc(`Pilote.${issue}`, names) }];
  const total = movement.history.cost + movement.passed.cost + movement.pending.cost;
  if ( total > cap + 1e-6 ) return [{ key: "pilotFar", line: loc("Pilote.TropLoin", { ...names, max: pilot.rule.distance, units: pilot.rule.units }) }];
  return [];
}

/** On arrival, does the object stay within `tether` of its caster (Duplicity: 36 m)? True with no caster on the scene. */
function withinTether(token, pilot, destination) {
  const caster = summonerToken(pilot);
  if ( !pilot.rule.tether || !caster || (caster.parent !== token.parent) || !destination ) return true;
  let limit = lengthIn(pilot.rule.tether.distance, pilot.rule.tether.units, token.parent.grid.units);
  return distanceBetween(caster, token, { posB: positionOf(destination) }).value <= limit + 1e-6;
}

/** On arrival, is the object within `cluster` of another object of the same spell? True if it is alone. */
function nearAnother(token, pilot, destination) {
  const others = groupTokens(pilot).filter(t => t !== token);
  if ( !others.length || !destination ) return true;
  let limit = lengthIn(pilot.rule.cluster.distance, pilot.rule.cluster.units, token.parent.grid.units);
  const at = positionOf(destination);
  return others.some(other => distanceBetween(other, token, { posB: at }).value <= limit + 1e-6);
}
