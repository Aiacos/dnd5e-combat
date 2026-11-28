/**
 * Movement modes and elevation (SPEC §17.4, user request of 2026-09-26): walk and crawl on the ground,
 * fly at least 5 ft above it, burrow at least 5 ft below. The ground: the Surface that stops movement under the
 * token, otherwise the base of its level (adapter/altitude.mjs).
 *
 *  - Every move (drag, keyboard, click on the ground, HUD elevation field) is aligned BEFORE it starts: its points
 *    receive the elevation of their mode (`alignPath`, core/altitude.mjs). `preMoveToken` is synchronous and its
 *    waypoints are frozen (client/documents/token.mjs:1976-1990): a path to correct is refused then relaunched corrected,
 *    as Opportunity Attacks already do (runtime/actions.mjs). On the ground, a step of 5 ft at most: higher
 *    means climbing (refused), lower is a fall — the path stops above the void and dnd5e puts the creature
 *    "Falling" (documents/token.mjs:436), the GM makes it fall with a click on the icon (canvas/token.mjs:168), damage
 *    included. The GM is not held back: for them the ground is followed whatever happens.
 *  - Changing mode (token HUD, action bar: an update of `movementAction`) moves the token vertically in the
 *    right mode, at the cost of movement: take off by 5 ft, land, burrow in, come back up. This choice counts as a decision: a
 *    creature without a fly (or burrow) speed gets it, equal to its walk, through an effect that the engine removes
 *    when it takes a mode that does not need it (user request, 2026-09-26). Refused only if the
 *    turn no longer allows this movement.
 *  - Going up or down through the HUD elevation field, without moving: above the ground, the creature takes off if it
 *    can; below, it burrows; on the ground, it lands.
 *  - Not affected: the engine's forced movements (`cleared`: push, grapple, swallow), teleportation, the
 *    driven objects (Bigby's Hand, spheres), whatever is not a creature, and cancellation.
 */

import { MODULE_ID } from "../constants.mjs";
import { placementOf, alignPath, modeShift, coherentElevation, speedFor, flightChoice } from "../core/altitude.mjs";
import { climbSystemOn } from "../core/climb-system.mjs";
import { walkOptions, continuedFlags } from "../adapter/movement.mjs";
import { boundsUnder, levelAt, clearanceOf, modeRefusalFor, groundModeOf, effectiveMode, grantSpeedFor, revokeSpeedsBut, grantedSpeedEffects, isAirborne, speedsOf } from "../adapter/altitude.mjs";
import { pilotOf, isIntangible } from "../adapter/pilot.mjs";
import { route } from "./router.mjs";
import { loc, log, notice } from "./shared.mjs";
import { forceMoveLater } from "./move-gate.mjs";
import { isEthereal } from "../adapter/plane.mjs";

export const ALTITUDE_SETTING = "altitude";

/**
 * §218: make a token fall right away (dnd5e's fall, damage included) — wired by runtime/falls.mjs (`setFallAction`):
 * this file does not import the falls one, which depends on climbing, which depends on this one.
 */
let fallAction = null;
export const setFallAction = fn => { fallAction = fn; };
export async function fallNow(token) {
  if ( !climbSystemOn() || isEthereal(token) ) return false;   // §224: system off; §225: no fall in the Ethereal
  return fallAction ? fallAction(token) : false;
}

/** Is the token "Falling" per dnd5e, in the air, in a ground mode (neither flying nor climbing)? */
export function fallingAloft(token) {
  if ( !climbSystemOn() || !token.actor?.statuses?.has("falling") ) return false;
  if ( placementOf(token._source.movementAction) !== "ground" ) return false;
  return (token._source.elevation ?? 0) > boundsUnder(token, token._source).ground + 1e-6;
}
const BETTER_LEVELS = "baileywiki-better-levels";

const MOVEMENT_FIELDS = ["x", "y", "elevation", "level", "width", "height", "depth", "shape"];

function concerned(token, { switchedOff=false }={}) {
  // §224: the GM's switch overrides the "Movement modes and elevation" setting — off, no alignment, no mode imposed
  // (`switchedOff`: the question is still asked, for the HUD's level change alone).
  if ( (!switchedOff && !climbSystemOn()) || !game.settings.get(MODULE_ID, ALTITUDE_SETTING) ) return false;
  const actor = token.actor;
  if ( !actor || (actor.system?.isCreature === false) ) return false;
  if ( isEthereal(token) ) return false;   // §225: the Ethereal does not obey gravity — free elevation
  return !pilotOf(token) && !isIntangible(token);
}

/** What is copied from a waypoint to relaunch a move (as in runtime/actions.mjs). */
const copyOf = ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
  ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint });

const refuse = (token, key, data) => {
  ui.notifications.warn(loc(`Altitude.${key}`, { name: token.name, ...data }));
  notice(token, loc(`Retour.Altitude.${key}`));
};

/**
 * Like the core's `changeLevel` behavior (change-level.mjs:110): the view of whoever controls the token follows its
 * level change, if it was looking at the level it comes from.
 */
async function followLevel(token, from) {
  const to = token._source.level;
  if ( (to === from) || !token.parent.isView || (canvas.level?.id !== from) || !token.object?.controlled ) return;
  await token.parent.view({ level: to, controlledTokens: [token.id] });
}

/* -------------------------------------------- */
/*  Changer de mode                             */
/* -------------------------------------------- */

/**
 * Puts the token into mode `to`: the vertical movement first (paid as a move), then the mode.
 * @returns {Promise<boolean>}
 */
export async function switchMode(token, to, shift, value=to) {
  if ( shift ) {
    const reached = () => Math.abs((token._source.elevation ?? 0) - shift.elevation) <= 1e-6;
    // The level follows the elevation (levelAt), except underground.
    const level = (placementOf(shift.action) === "under") ? token._source.level : levelAt(token.parent, shift.elevation, token._source.level);
    const moved = { elevation: shift.elevation, action: shift.action, ...((level !== token._source.level) ? { level } : {}) };
    const from = token._source.level;
    await token.move([moved], { [MODULE_ID]: { altitude: true } });
    if ( !reached() && (placementOf(to) === "ground") ) {
      // Returning to the ground of one's level must never stay blocked: a token placed ON a surface (floor above)
      // can no longer descend while flying (the core treats it as solid downwards). A `displace` step is not
      // constrained (constrainMovementPath: "unless teleporting"); the target ground is that of its own level.
      await token.move([{ ...moved, action: "displace" }], { [MODULE_ID]: { altitude: true }, constrainOptions: { ignoreWalls: true } });
      if ( reached() ) log(`${token.name}: back to the ground via a displace step (blocked by a surface)`);
    }
    if ( !reached() ) return false;
    await followLevel(token, from);
  }
  if ( token._source.movementAction !== value ) await token.update({ movementAction: value }, { [MODULE_ID]: { altitude: true } });
  log(`${token.name}: mode ${to}${shift ? `, elevation ${shift.elevation}` : ""}`);
  return true;
}

/**
 * The mode chosen in the token HUD (or the action bar): the missing speed is granted, the vertical movement done,
 * the mode set, then the granted speeds that are no longer used removed. `value` null: the core's default mode.
 * @returns {Promise<boolean>}
 */
async function applyMode(token, value) {
  const to = value ?? CONFIG.Token.movement.defaultAction;
  const granted = await grantSpeedFor(token, to);
  if ( granted ) notice(token, loc("Retour.Altitude.Accordee", { mode: game.i18n.localize(CONFIG.Token.movement.actions[to]?.label ?? to) }), "gain");
  const pos = token._source;
  const { ground, ceiling } = boundsUnder(token);
  const shift = modeShift(token.movementAction, to, pos.elevation ?? 0, ground, clearanceOf(token.parent), ceiling);
  if ( !(await switchMode(token, to, shift, value)) ) {
    if ( granted ) await revokeSpeedsBut(token, token.movementAction);
    return false;
  }
  await revokeSpeedsBut(token, to);
  return true;
}

/** A speed granted by the engine that mode `to` does not use? */
const staleGrant = (token, to) => grantedSpeedEffects(token.actor).some(e => e.getFlag(MODULE_ID, "grantedSpeed") !== speedFor(to));

/** An update of `movementAction` alone: we replace it with what it asks for (speed, vertical movement). */
function onPreUpdateToken(token, changes, options) {
  if ( !("movementAction" in changes) || options?.[MODULE_ID]?.altitude ) return true;
  if ( MOVEMENT_FIELDS.some(k => k in changes) || !concerned(token) ) return true;
  const value = changes.movementAction ?? null;
  const to = value ?? CONFIG.Token.movement.defaultAction;
  if ( options?.[MODULE_ID]?.forced ) {
    // Knocked Prone, stood up: not a mode choice; a granted fly speed that is no longer used is dropped anyway.
    if ( staleGrant(token, to) ) setTimeout(() => revokeSpeedsBut(token, to).catch(err => console.error(`${MODULE_ID} | granted speed`, err)), 0);
    return true;
  }
  const pos = token._source;
  const { ground, ceiling } = boundsUnder(token);
  const shift = modeShift(token.movementAction, to, pos.elevation ?? 0, ground, clearanceOf(token.parent), ceiling);
  if ( !shift && !modeRefusalFor(token.actor, to) && !staleGrant(token, to) ) return true;
  applyMode(token, value).then(ok => { if ( !ok ) refuse(token, "Impossible"); })
    .catch(err => console.error(`${MODULE_ID} | mode change`, err));
  return false;
}

/* -------------------------------------------- */
/*  S'envoler, atterrir (menu, §238)            */
/* -------------------------------------------- */

/**
 * §238: what the menu offers for flight to this token (`takeOff`, `land`), or null. Also when the "Climbing and falls" switch
 * is off (§224, the case of `dnd-6`): taking off and landing are choices, not a fall or an imposed alignment.
 */
export function flightChoiceOf(token) {
  if ( !token?.isOwner || !concerned(token, { switchedOff: true }) ) return null;
  const { ground, ceiling } = boundsUnder(token);
  // The document's mode, not the source: a token whose mode nobody chose has `null` in source (the core's default mode).
  return flightChoice({ mode: token.movementAction, airborne: isAirborne(token), flySpeed: Number(speedsOf(token.actor).fly) || 0,
    ground, ceiling, clearance: clearanceOf(token.parent) });
}

/**
 * §238: take off (5 ft above the ground) or land (descend while flying to its ground, from one level to another if needed) —
 * the same path as the mode choice in the core's HUD (`applyMode`): vertical movement paid as a move, then the mode.
 * In the air in a ground mode (a creature that flies without its mode having been changed): the fly mode first, then the landing.
 * @returns {Promise<boolean>}
 */
export async function takeFlight(token, choice=flightChoiceOf(token)) {
  if ( !choice ) return false;
  let ok;
  if ( choice === "takeOff" ) ok = await applyMode(token, "fly");
  else {
    if ( placementOf(token.movementAction) !== "air" ) await switchMode(token, "fly", null);
    ok = await applyMode(token, groundModeOf(token.actor));
  }
  if ( !ok ) refuse(token, "Impossible");
  log(`${token.name}: ${choice === "takeOff" ? "takes off" : "lands"} from the menu${ok ? "" : " — refused"}`);
  return ok;
}

/** §238: the entries of the menu of one's own token (GM and players), according to its speeds: "Take Off" or "Land". */
export function flightEntries(token) {
  const choice = flightChoiceOf(token);
  if ( choice === "takeOff" ) return [{ icon: "fa-solid fa-dove", label: loc("Menu.SEnvoler"), run: () => takeFlight(token, choice) }];
  if ( choice === "land" ) return [{ icon: "fa-solid fa-plane-arrival", label: loc("Menu.Atterrir"), run: () => takeFlight(token, choice) }];
  return [];
}

/* -------------------------------------------- */
/*  Align every move                            */
/* -------------------------------------------- */

/**
 * The level of each point of a path from its elevation (`levelAt`): rising above the top of its level makes it
 * pass into the one above, descending below its bottom into the one below — the core does not do this (user
 * request, 2026-09-26). A point whose level differs from the start's (stairs, `displace` step of the A*) keeps
 * its own. When burrowing, we stay in our level: below the ground, we are not in the cellar below.
 */
function levelsAlong(token, origin, waypoints, elevations) {
  let current = origin.level;
  return waypoints.map((w, n) => {
    const base = ((w.level ?? origin.level) !== origin.level) ? w.level : current;
    current = (placementOf(w.action) === "under") ? base : levelAt(token.parent, elevations[n], base);
    return current;
  });
}

/** Does the move only go up or down (HUD elevation field, elevation keys)? */
function isPureVertical(origin, waypoints) {
  const last = waypoints.at(-1);
  return waypoints.every(w => (w.x === origin.x) && (w.y === origin.y) && ((w.level ?? origin.level) === origin.level))
    && (Math.abs((last.elevation ?? 0) - (origin.elevation ?? 0)) > 1e-6);
}

/** Does the move only change level, without moving or changing elevation (HUD "level" button)? */
function isLevelOnly(origin, waypoints) {
  const last = waypoints.at(-1);
  return waypoints.every(w => (w.x === origin.x) && (w.y === origin.y))
    && ((last.level ?? origin.level) !== origin.level) && (Math.abs((last.elevation ?? 0) - (origin.elevation ?? 0)) < 1e-6);
}

/** In place, to another level, placed at its base: the recipe of the core's `changeLevel` behavior (stairs). */
function isStairsLevelChange(token, origin, waypoints) {
  const last = waypoints.at(-1);
  if ( !last.level || (last.level === origin.level) ) return false;
  if ( !waypoints.every(w => (w.x === origin.x) && (w.y === origin.y)) ) return false;
  const base = token.parent.levels.get(last.level)?.elevation?.base;
  return Number.isFinite(base) && (Math.abs((last.elevation ?? 0) - base) < 1e-6);
}

/**
 * Changing level through the HUD: the token goes to the ground of that level, at the elevation of its mode (flying 5 ft above,
 * burrowing 5 ft below). A single `displace` step (the recipe of the core's `changeLevel` behavior, change-level.mjs:163):
 * a floor does not stop it. What the "Set elevation on level change" setting of Baileywiki Better Levels did
 * (it always puts the token at the bottom of the level, whatever its mode) — to turn off when this setting is active.
 */
function levelOnlyMove(token, last) {
  const bounds = boundsUnder(token, last);
  // We chose THIS level: if its ground is elsewhere (no floor of the storey here, ground-floor ground), its base.
  const level = token.parent.levels.get(last.level);
  const bottom = level?.elevation?.bottom ?? -Infinity;
  const top = level?.elevation?.top ?? Infinity;
  const ground = ((bounds.ground >= bottom) && (bounds.ground < top)) ? bounds.ground : (level?.elevation?.base ?? bounds.ground);
  const ceiling = bounds.ceiling;
  const elevation = coherentElevation(token.movementAction, ground, ground, clearanceOf(token.parent), ceiling);
  const from = token._source.level;
  log(`${token.name}: level ${from} → ${last.level}, elevation ${elevation} (ground ${ground})`);
  token.move([{ elevation, level: last.level, action: "displace" }], { [MODULE_ID]: { altitude: true }, constrainOptions: { ignoreWalls: true } })
    .then(() => followLevel(token, from))
    .catch(err => console.error(`${MODULE_ID} | level change`, err));
  return false;
}

/**
 * Going up or down in place: the mode follows the wanted elevation — above the ground fly, below burrow, on the ground the
 * ground mode. Same mode as before: we let the ordinary alignment do it.
 */
function verticalMove(token, last, movement=null, forced=false) {
  const { ground, ceiling } = boundsUnder(token);
  const clearance = clearanceOf(token.parent);
  const wanted = last.elevation ?? 0;
  const current = token.movementAction;
  if ( placementOf(current) === null ) return null;   // climbing, swimming, jumping: elevation is free
  const to = (wanted > ground + 1e-6) ? "fly" : ((wanted < ground - 1e-6) ? "burrow"
    : ((placementOf(current) === "ground") ? current : groundModeOf(token.actor)));
  log(`${token.name}: elevation ${token._source.elevation} → ${wanted} in place (level ${token._source.level}, ground ${ground}, ceiling ${ceiling}): ${current} → ${to}`);
  if ( placementOf(to) === placementOf(current) ) return null;
  if ( modeRefusalFor(token.actor, to) ) {
    // The GM places wherever they want: a creature without fly left in the air is "Falling" (dnd5e). §412: a player who forces too.
    if ( game.user.isGM || forced ) return true;
    // §412 (issue #44, batch 5): the legality window; forced, the same climb restarts (`forcedMove`), as the GM would place it.
    const mode = game.i18n.localize(CONFIG.Token.movement.actions[to]?.label ?? to);
    notice(token, loc("Retour.Altitude.SansVitesse"));
    if ( movement ) forceMoveLater(token, movement, [{ key: `noSpeed.${to}`, line: loc("Altitude.SansVitesse", { name: token.name, mode }) }]);
    else refuse(token, "SansVitesse", { mode });
    return false;
  }
  const elevation = coherentElevation(to, wanted, ground, clearance, ceiling);
  const action = (placementOf(to) === "ground") ? current : to;
  switchMode(token, to, { elevation, action }).then(ok => { if ( !ok ) refuse(token, "Impossible"); })
    .catch(err => console.error(`${MODULE_ID} | mode change from elevation`, err));
  return false;
}

function onPreMoveToken(token, movement, operation) {
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement);   // §99: chunk chained by the core
  if ( flags?.cleared || flags?.altitude || operation?.isUndo ) return true;
  // §224: climbing and falling system off — the move keeps the requested elevation; only the HUD's "level" button still places
  // the token on the ground of the chosen level (otherwise it arrived there at its old elevation, under that level's floor).
  if ( !climbSystemOn() ) {
    const all = [...movement.passed.waypoints, ...movement.pending.waypoints];
    if ( !all.length || !concerned(token, { switchedOff: true }) ) return true;
    return (isLevelOnly(movement.origin, all) && !isStairsLevelChange(token, movement.origin, all)) ? levelOnlyMove(token, all.at(-1)) : true;
  }
  if ( !concerned(token) ) return true;
  // §218: dnd5e's fall (`plummet`: a `fall` step, from one level to another if needed, documents/token.mjs:398) passes as is
  // — realigned here, it was refused: the damage fell but the token stayed in the air, and every movement restarted a fall.
  if ( [...movement.passed.waypoints, ...movement.pending.waypoints].some(w => w.action === "fall") ) return true;
  // §218: a "Falling" token that we want to move falls first (damage included) — it used to be snapped to the ground silently,
  // from one level to another, without damage. The requested move is abandoned: it is redone once on the ground.
  if ( fallingAloft(token) ) {
    log(`${token.name}: falling — falls before moving`);
    fallNow(token).catch(err => console.error(`${MODULE_ID} | fall before moving`, err));
    return false;
  }
  const waypoints = [...movement.passed.waypoints, ...movement.pending.waypoints];
  if ( !waypoints.length ) return true;
  const origin = movement.origin;

  // §18.26: the level change of a staircase (the core's `changeLevel` behavior, change-level.mjs:163-164) — in
  // place, at the base of the chosen level, floors ignored. Realigning it would relaunch it without `ignoreWalls`: a floor
  // (Surface) would stop it (seen in play on 2026-09-26: the "go up / go down" dialog no longer led anywhere).
  if ( isStairsLevelChange(token, origin, waypoints) ) return true;
  if ( isLevelOnly(origin, waypoints) ) return levelOnlyMove(token, waypoints.at(-1));

  if ( isPureVertical(origin, waypoints) ) {
    const verdict = verticalMove(token, waypoints.at(-1), movement, !!flags?.forcedMove);
    if ( verdict !== null ) return verdict;
  }

  const clearance = clearanceOf(token.parent);
  // A ground mode clearly in the air (or underground) on a creature that flies (or burrows): it takes that mode rather
  // than being brought back to the ground. The mode first, then the same move in that mode (it comes back through here: aligned,
  // then checked by the turn).
  const implied = effectiveMode(token, origin);
  if ( implied !== token.movementAction ) {
    const again = waypoints.map(w => ({ ...copyOf(w), action: (placementOf(w.action) === "ground") ? implied : w.action }));
    (async () => {
      if ( !(await switchMode(token, implied, null)) ) return;
      await token.move(again, walkOptions(movement));
    })().catch(err => console.error(`${MODULE_ID} | movement in the elevation's mode`, err));
    return false;
  }
  const points = waypoints.map(w => ({ elevation: w.elevation ?? 0, action: w.action, ...boundsUnder(token, w) }));
  const result = alignPath(origin, points, { clearance, step: clearance, lenient: game.user.isGM });
  const levels = levelsAlong(token, origin, waypoints.slice(0, result.kept), result.elevations);
  const relevelled = levels.some((level, n) => level !== waypoints[n].level);
  if ( !result.changed && !relevelled ) return true;
  log(`${token.name}: path aligned — ${points.map((p, n) => `${p.action} ${p.elevation}→${result.elevations[n] ?? "×"} (ground ${p.ground}, ceiling ${p.ceiling}, level ${levels[n] ?? "×"})`).join("; ")}${result.issue ? ` [${result.issue}]` : ""}`);
  if ( result.issue === "tooHigh" ) refuse(token, "TropHaut");
  if ( result.issue === "falls" ) notice(token, loc("Retour.Altitude.Chute"));
  if ( !result.kept ) return false;
  const again = waypoints.slice(0, result.kept).map((w, n) => ({ ...copyOf(w), elevation: result.elevations[n], level: levels[n] }));
  const from = token._source.level;
  token.move(again, { ...walkOptions(movement), [MODULE_ID]: { altitude: true } }).then(() => relevelled && followLevel(token, from))
    .catch(err => console.error(`${MODULE_ID} | movement aligned to the ground`, err));
  return false;
}

/* -------------------------------------------- */

export function registerAltitude() {
  game.settings.register(MODULE_ID, ALTITUDE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${ALTITUDE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${ALTITUDE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  // Baileywiki Better Levels resets the elevation to the bottom of the level at every level change (updateToken,
  // token-hud.mjs:44): incompatible with a level that follows the elevation (seen in play on 2026-09-26: raised to 16 ft, brought
  // back to 15; lowered to 5 ft, placed at 0 and read as a landing). We tell the GM.
  route("ready", () => {
    if ( !game.user.isGM || !game.settings.get(MODULE_ID, ALTITUDE_SETTING) ) return;
    if ( !game.modules.get(BETTER_LEVELS)?.active ) return;
    let on = false;
    try { on = game.settings.get(BETTER_LEVELS, "setElevationOnLevelChange") === true; } catch { /* setting absent */ }
    if ( on ) ui.notifications.warn(loc("Altitude.BetterLevels"), { permanent: true });
  }, { label: "movement modes: Better Levels setting" });
  route("preUpdateToken", onPreUpdateToken, { cancellable: true, label: "movement mode: elevation" });
  // Before the turn ceiling and the Opportunity Attacks (runtime/actions.mjs): they judge the aligned path.
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "movement: mode elevation" });
}
