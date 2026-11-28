/**
 * Test functions (api.mcp): moves along the engine path — A*, stairs, follow, familiar, view, teleportation,
 * rush, doors, Opportunity Attack threats. Extracted from runtime/testing.mjs.
 */

import { strike } from "./storm.mjs";
import { MODULE_ID } from "../constants.mjs";
import { afterTeleportOptions } from "./teleport-options.mjs";
import { carryPassengers, choosePassengers } from "./passengers.mjs";
import { planPath, stairsOf, stairsDestinations, stopWalking } from "../adapter/movement.mjs";
import { combatantFor, readBudget, movementOf } from "../adapter/turn.mjs";
import { setDoorOpen, doorState, pickLock, forceDoor, unlockWithKey, lockEntriesFor, handleLockQuery, DOOR_UNLOCKED_HOOK, NOISE_HOOK, LOCK_ATTEMPT_HOOK } from "./doors.mjs";
import { triesOf } from "../adapter/locks.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { jumpOptionsOf } from "../adapter/jump.mjs";
import { jumpTo, moveTo, movementCap, selfTeleportOf, teleportTo, afterTeleport, teleportClick, dashStrike, dashTargets, dashProblem, dashLimit, lineDashOf, transpose as transposeIntent, takeStairs as takeStairsIntent, gapCells, verticalGapCells, tooHighFor, reachCells, basicAttack, rangeStatus, engage, approach } from "./actions.mjs";
import { dismissFamiliar, recallFamiliar, recallRefusal, canPocket, canRecall } from "./familiar.mjs";
import { pocketOf, isFamiliarToken, emptyPocket } from "../adapter/familiar.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { leaderOf, followersOf, follow as followIntent, unfollow as unfollowIntent } from "./follow.mjs";
import { dismount, mountIssues, mountState, mountUp } from "./mount.mjs";
import { opportunityThreats, lastOpportunityMisses } from "./reactions.mjs";
import { sleep } from "./shared.mjs";
import { cellArg, finite, gmOnly, positionJson, viewedToken, waypointOf, windows } from "./testing-shared.mjs";
import { budget } from "./testing-rules.mjs";
import { wall } from "./testing-areas.mjs";
import { hoistOnto, grabEdge, startClimb, dropDown as dropDownIntent, canClimb, climbRoom, canClimbCeiling, climbToCeiling, ceilingRoom, canClimbDown, climbDown as climbDownIntent, descentRoom, climbStateOf, climbHoldsAt, climbToward as climbTowardIntent } from "./climb.mjs";
import { wallsNear, isClimbing, isOnCeiling, climbingOf, climbRules, canWalkCeilings, ceilingPerchFor, FLIP_FLAG, inSlipperyZone, canWalkCeilingsAt, acrobaticFor, ledgesOf, edgesBelowOf, climbFallReasonFor } from "../adapter/climb.mjs";
import { speedGrantEffects } from "./speed-grants.mjs";
import { flightChoiceOf, flightEntries, takeFlight } from "./altitude.mjs";
import { boundsUnder, isAirborne, speedsOf } from "../adapter/altitude.mjs";
import { pilotOf } from "../adapter/pilot.mjs";
import { isEthereal } from "../adapter/plane.mjs";
import { MODE_STATUSES } from "../adapter/conditions.mjs";

/** The scene's stairs and ladders, with the cells they cover (center in the region). */
export function stairs({ tokenId }) {
  const token = viewedToken({ tokenId });
  const grid = token.parent.grid;
  return stairsOf(token.parent, token.actor).map(({ region, levels, multiplier }) => {
    const b = region.bounds;   // client/documents/region.mjs:129
    const from = grid.getOffset({ x: b.x, y: b.y });
    const to = grid.getOffset({ x: b.right - 1, y: b.bottom - 1 });
    const cells = [];
    for ( let i = from.i; i <= to.i; i++ ) for ( let j = from.j; j <= to.j; j++ ) {
      if ( region.polygonTree.testPoint(grid.getCenterPoint({ i, j }), 0.75) ) cells.push({ i, j });
    }
    return { regionId: region.id, name: region.name, levels, multiplier, elevation: { bottom: finite(region.elevation.bottom), top: finite(region.elevation.top) }, cells };
  });
}

/** The path the engine would take, without moving. `maxCost`: cost ceiling (grid unit), otherwise the turn's. */
export function plan({ tokenId, cell, point, levelId, maxCost }) {
  const token = viewedToken({ tokenId });
  const target = cellArg(token, { cell, point });
  const cap = Number.isFinite(maxCost) ? maxCost : movementCap(token);
  const found = planPath(token, { cell: target, level: levelId ?? token._source.level }, { maxCost: cap, throughDoors: true });
  if ( !found ) return { found: false };
  return {
    found: true,
    arrives: found.arrives,
    door: found.door?.id ?? null,
    maxCost: finite(cap),
    waypoints: found.waypoints.map(waypointOf),
    beyond: found.beyond.map(waypointOf)
  };
}

/** The token's movement budget in the current combat (null outside combat). */
export function movement({ tokenId }) {
  const token = viewedToken({ tokenId });
  const combatant = token.actor ? combatantFor(token.actor) : null;
  const out = { position: positionJson(token), viewedLevel: canvas.level?.id ?? null, cap: finite(movementCap(token)), combat: null };
  if ( !combatant ) return out;
  const m = movementOf(combatant, readUnitFactors());
  const budget = readBudget(combatant);
  out.combat = { combatantId: combatant.id, spent: m?.spent ?? null, speed: m?.speed ?? null, units: m?.units ?? null, climbed: Number(budget.climbed) || 0 };
  return out;
}

/**
 * Moves the token like a move click (`moveTo`: A*, doors, stairs, Opportunity Attacks, budget), and waits until it has
 * arrived. Returns the before / after positions and the windows opened during the move (the core's "Change Level"
 * dialog if it opened). §99: `stopAfterMs` stops the walk en route (like a click elsewhere),
 * `pauseAfterMs` pauses the game en route (and resumes it on arrival).
 */
export async function move({ tokenId, cell, point, levelId, action, stopAfterMs, pauseAfterMs }) {
  const token = viewedToken({ tokenId });
  const target = cellArg(token, { cell, point });
  const opened = new Set(foundry.applications.instances.keys());
  const before = positionJson(token);
  const started = Date.now();
  const timers = [];
  if ( Number.isFinite(stopAfterMs) ) timers.push(setTimeout(() => stopWalking(token), stopAfterMs));
  if ( Number.isFinite(pauseAfterMs) ) timers.push(setTimeout(() => game.togglePause(true, { broadcast: true }), pauseAfterMs));
  try { await moveTo(token, token.parent.grid.getCenterPoint(target), { action: action ?? null, level: levelId ?? null }); }
  finally {
    timers.forEach(clearTimeout);
    if ( Number.isFinite(pauseAfterMs) && game.paused ) game.togglePause(false, { broadcast: true });
  }
  const after = positionJson(token);
  const newWindows = windows().filter(w => !opened.has(w.id));
  return { before, after, elapsedMs: Date.now() - started, viewedLevel: canvas.level?.id ?? null, newWindows };
}

/**
 * §224: a "by hand" move, like dragging or the HUD elevation field — `token.move` of a single point (cell `cell`, otherwise in
 * place) to `elevation` (otherwise its own), in the `action` mode (otherwise its own), without the engine's A*; returns the
 * positions and the "Falling" / Prone conditions afterwards (we wait a bit: dnd5e's fall lands after the move).
 */
export async function rawMove({ tokenId, cell=null, elevation=null, action=null, settleMs=1500 }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const at = cell ? token.parent.grid.getTopLeftPoint(cell) : { x: token._source.x, y: token._source.y };
  const waypoint = { ...at, elevation: Number.isFinite(elevation) ? elevation : (token._source.elevation ?? 0), action: action ?? token._source.movementAction };
  const result = await token.move([waypoint]).catch(err => ({ error: err.message }));
  await new Promise(resolve => setTimeout(resolve, settleMs));
  return { result, before, after: positionJson(token),
    falling: token.actor?.statuses?.has("falling") === true, prone: token.actor?.statuses?.has("prone") === true };
}

/** §41.2: where the stairs under this point lead for this token (what the cursor and the menu read). */
export function stairsAt({ tokenId, point }) {
  return stairsDestinations(viewedToken({ tokenId }), point);
}

/** §41.2: take the stairs under this point to `levelId`, like a click on them (without the core's dialog). */
export async function takeStairs({ tokenId, point, levelId }) {
  const token = viewedToken({ tokenId });
  const opened = new Set(foundry.applications.instances.keys());
  const before = positionJson(token);
  await takeStairsIntent(token, point, levelId);
  return { before, after: positionJson(token), viewedLevel: canvas.level?.id ?? null, newWindows: windows().filter(w => !opened.has(w.id)) };
}

/** §41.3: the order to follow, to stop following, and who follows whom. */
export async function follow({ followerId, leaderId }) {
  return { following: await followIntent(viewedToken({ tokenId: followerId }), viewedToken({ tokenId: leaderId })) };
}

/** The token `tokenId` (displayed scene) stops following its leader (§41.3) → `{ stopped }`. */
export async function unfollow({ tokenId }) {
  return { stopped: await unfollowIntent(viewedToken({ tokenId })) };
}

/** Whom the token `tokenId` follows, who follows it, and its position: `{ leader, followers, position }` (§41.3). Read-only. */
export function followState({ tokenId }) {
  const token = viewedToken({ tokenId });
  return { leader: leaderOf(token)?.id ?? null, followers: followersOf(token).map(t => t.id), position: positionJson(token) };
}

/**
 * §490 (B08): mount and order to a companion. `action`: "state" (read), "mount" (`tokenId` mounts `targetId`), "dismount"
 * (`tokenId` dismounts). `issues`: what would refuse the mount, read BEFORE the gesture (keys `Monture.Souci.*`).
 * A forceable refusal would open the legality window, which a scenario does not answer: the gesture overrides it without a window
 * (`force`, default true). Returns the state of both tokens.
 */
export async function mount({ action="state", tokenId, targetId=null, force=true }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const target = targetId ? viewedToken({ tokenId: targetId }) : null;
  const issues = target ? mountIssues(token, target) : [];
  let done = null;
  if ( action === "mount" ) done = await mountUp(token, target, { force });
  else if ( action === "dismount" ) done = await dismount(token, { force });
  return { done, issues, token: { ...mountState(token), position: positionJson(token) },
    target: target ? { ...mountState(target), position: positionJson(target) } : null };
}

/**
 * §107: the state of a familiar or master — recognized familiar, vision, basic actions, pocket dimension (the kept familiar and
 * its HP; `clear` empties it); and the gestures: dismissal (`tokenId` of the familiar), recall (`tokenId` of the master, `point`).
 */
export async function familiar({ tokenId, clear=false }) {
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) return { present: false };
  if ( clear && game.user.isGM ) await emptyPocket(token.actor);   // reset to a scenario's state
  const pocket = pocketOf(token.actor);
  return { present: true, familiar: isFamiliarToken(token), sight: token._source.sight?.enabled === true,
    basics: (token.actor?.items ?? []).map(basicActionOf).filter(Boolean).sort(), canPocket: canPocket(token), canRecall: canRecall(token),
    pocket: pocket ? { name: pocket.name, hp: pocket.token.delta?.system?.attributes?.hp?.value ?? null,
      items: (pocket.token.delta?.items ?? []).map(i => i.name) } : null };
}

/** §107: the familiar `tokenId` goes into its pocket dimension (like the menu entry) → `{ done }`. */
export async function familiarPocket({ tokenId }) {
  return { done: await dismissFamiliar(viewedToken({ tokenId })) };
}

/** §107: the master `tokenId` recalls its familiar to `point` → `{ done, refusal, tokens }` (the scene's familiars, with their HP). */
export async function familiarRecall({ tokenId, point }) {
  const token = viewedToken({ tokenId });
  const refusal = recallRefusal(token, point);
  const done = refusal ? false : await recallFamiliar(token, point);
  return { done, refusal, tokens: token.parent.tokens.filter(t => isFamiliarToken(t)).map(t => ({ id: t.id, name: t.name, x: t.x, y: t.y,
    hp: t.actor?.system?.attributes?.hp?.value ?? null })) };
}

/** Displays a scene level for the GM (an engine move makes the view follow: the scenario restores it). */
export async function view({ levelId }) {
  gmOnly();
  if ( !canvas.scene?.levels?.get?.(levelId) ) throw new Error(`level ${levelId} missing from the viewed scene`);
  if ( canvas.level?.id !== levelId ) await canvas.scene.view({ level: levelId });
  return { viewedLevel: canvas.level?.id ?? null };
}

/** §67 ter: the engine's click during teleport aiming (a point of the scene), without the mouse. */
export function teleportPick({ x, y }) {
  return { picked: teleportClick({ x, y }) };
}

/**
 * A self-teleport destination (Misty Step), as the core's planning click would return it: the
 * plan goes through the same checkpoint (`dnd5e.teleport`, which the engine holds: range, occupied cell, view —
 * runtime/actions.mjs, `onTeleport`); once accepted, the token teleports (action "blink"). Only the click itself (the
 * core's interactive planning) is not played.
 */
export async function teleport({ tokenId, itemId, x, y, passengers=[] }) {
  const token = viewedToken({ tokenId });
  const activity = token.actor?.items.get(itemId)?.system.activities?.find(a => selfTeleportOf(a)) ?? null;
  if ( !activity ) throw new Error("no self-teleport on this item");
  // §264: the passengers designated as the player would — by targeting them before the jump.
  for ( const t of game.user.targets ) t.setTarget(false, { releaseOthers: false });
  for ( const id of passengers ) canvas.tokens.get(id)?.setTarget(true, { releaseOthers: false });
  const chosen = passengers.length ? await choosePassengers(token, selfTeleportOf(activity).passengers) : [];
  const from = { x: token._source.x, y: token._source.y, elevation: token._source.elevation ?? 0, level: token._source.level ?? null };
  // The same path as the player's click (`teleportSelf`): validation, `blink`, then the arrival activity (`teleport.then`).
  const accepted = await teleportTo(activity, token, { x, y });
  if ( accepted ) await carryPassengers(token, chosen);
  if ( accepted ) await afterTeleport(activity, selfTeleportOf(activity));
  // §92: the Fey Step options, as after the real gesture — without waiting for them (the scenario answers the question).
  if ( accepted ) afterTeleportOptions(activity, token, from).catch(err => console.error(err));
  return { accepted, position: positionJson(token) };
}

/** §23: who would threaten an Opportunity Attack on a straight-line move to this point (names). */
export function threats({ tokenId, point }) {
  const token = viewedToken({ tokenId });
  const at = token.parent.grid.getTopLeftPoint(token.parent.grid.getOffset(point));
  const waypoints = [{ x: at.x, y: at.y, elevation: token._source.elevation, action: "walk" }];
  return opportunityThreats(token, waypoints).map(e => (typeof e === "string")
    ? (fromUuidSync(e, { strict: false })?.name ?? e) : `${fromUuidSync(e.token, { strict: false })?.name ?? e.token} (reactive strike)`);
}

/**
 * §479: why creatures whose reach would be left by this straight-line move have no Opportunity Attack —
 * `[{ name, reason, notice }]`. `explain`: like a real move (debugger log, GM alert once per combat).
 */
export function missedOpportunities({ tokenId, point, explain=false }) {
  const token = viewedToken({ tokenId });
  const at = token.parent.grid.getTopLeftPoint(token.parent.grid.getOffset(point));
  opportunityThreats(token, [{ x: at.x, y: at.y, elevation: token._source.elevation, action: "walk" }], { explain });
  return lastOpportunityMisses().map(m => ({ name: fromUuidSync(m.token, { strict: false })?.name ?? m.token, reason: m.reason, notice: m.notice }));
}

/** §38.2: the place swap of "Trickster's Swap", like the menu entry (from the illusion or its caster); before / after positions. */
export async function transpose({ tokenId }) {
  const token = viewedToken({ tokenId });
  const at = t => ({ x: t._source.x, y: t._source.y });
  const before = at(token);
  const done = await transposeIntent(token);
  return { done, before, after: at(token) };
}

/**
 * §57: a straight-line rush ("Wind Strike") toward a given cell (top-left corner), without aiming: the same cell check, the same
 * targets, the same use without a template. `preview: true`: only the targets and what would refuse the cell
 * (`problem`, translation key or null), nothing launched.
 */
export async function dash({ tokenId, itemId, x, y, preview=false }) {
  gmOnly();
  const token = viewedToken({ tokenId });
  const activity = token.actor?.items.get(itemId)?.system.activities?.find(a => lineDashOf(a)) ?? null;
  if ( !activity ) throw new Error("no straight-line charge on this item");
  if ( preview ) {
    const to = { x, y, elevation: token._source.elevation ?? 0 };
    // The aiming limit (`dashRefusal`): the Speed converted into the scene's unit.
    return { targets: dashTargets(token, to, lineDashOf(activity)).map(t => t.name),
      problem: dashProblem(token, to, dashLimit(token))?.[0] ?? null };
  }
  const before = game.messages.contents.at(-1)?.id ?? null;
  const used = await dashStrike(activity, [{ consume: false, [MODULE_ID]: { confirmed: true, autoReact: "none" } }, {}, {}], { x, y });
  for ( let i = 0; (i < 30) && ((token._source.x !== x) || (token._source.y !== y)); i++ ) await sleep(100);
  const message = game.messages.contents.findLast(m => (m.type === "usage") && m.getFlag(MODULE_ID, "dash"));
  return { used, position: positionJson(token), messageId: (message && (message.id !== before)) ? message.id : null,
    targets: (message?.system.targets ?? []).map(t => t.name), regions: canvas.scene.regions.filter(r => r.getFlag("dnd5e", "activity") === activity.uuid).length };
}

/**
 * §152: open or close a door like the "Open / Close" menu entry (`setDoorOpen`: move up to contact via
 * `approachDoor`, then act). Returns the door's state and the token's position afterwards.
 */
export async function door({ tokenId, wallId, open=true }) {
  const token = viewedToken({ tokenId });
  const wall = canvas.walls.get(wallId);
  if ( !wall?.isDoor ) throw new Error(`wall ${wallId} is not a door of the viewed scene`);
  await setDoorOpen(token, wall, open);
  return { state: doorState(wall), x: token._source.x, y: token._source.y };
}

/**
 * §244: a door lock. Without `total`, the menu path (move up, pay the action in combat, roll the check, judge); with
 * `total`, only the active GM's judgment, for a wanted result. Returns the verdict, the door's state, the noted attempts, the menu
 * entries and the public hooks fired during the call.
 */
export async function lock({ tokenId, wallId, method="pick", total=null }) {
  const token = viewedToken({ tokenId });
  const wall = canvas.walls.get(wallId);
  if ( !wall?.isDoor ) throw new Error(`wall ${wallId} is not a door of the viewed scene`);
  const fired = [];
  const onUnlock = ({ door, token: t, method: m }) => fired.push({ hook: "doorUnlocked", door: door?.id, token: t?.id, method: m });
  const onNoise = ({ token: t, point, cause }) => fired.push({ hook: "noise", token: t?.id, point, cause });
  const onAttempt = ({ door, token: t, method: m, outcome: o, total: n }) => fired.push({ hook: "lockAttempt", door: door?.id, token: t?.id, method: m, outcome: o, total: n });
  const hooks = [[DOOR_UNLOCKED_HOOK, Hooks.on(DOOR_UNLOCKED_HOOK, onUnlock)], [NOISE_HOOK, Hooks.on(NOISE_HOOK, onNoise)],
    [LOCK_ATTEMPT_HOOK, Hooks.on(LOCK_ATTEMPT_HOOK, onAttempt)]];
  let outcome;
  try {
    if ( total !== null ) outcome = (await handleLockQuery({ wall: wall.document.uuid, token: token.uuid, method, total }))?.outcome ?? null;
    else outcome = await ({ pick: pickLock, force: forceDoor, key: unlockWithKey })[method](token, wall);
  } finally { for ( const [name, id] of hooks ) Hooks.off(name, id); }
  return { outcome, state: doorState(wall), tries: triesOf(wall), entries: lockEntriesFor(token, wall), fired, x: token._source.x, y: token._source.y };
}

/* -------------------------------------------- */
/*  §177: diagnostic, for scenarios                */

/* -------------------------------------------- */
/*  Escalade (§192)                             */
/* -------------------------------------------- */

/** The state of a climber (or a candidate): walls touched, mode, status, what it can climb, world rules; §192 batch 2: the ceiling. */
export function climbState({ tokenId }) {
  const token = viewedToken({ tokenId });
  const walls = wallsNear(token).map(w => w.id);
  const room = canClimb(token) || isClimbing(token) ? climbRoom(token) : null;
  const ceiling = ceilingRoom(token);
  return { walls, canClimb: canClimb(token), climbing: isClimbing(token), status: token.actor?.statuses?.has(MODE_STATUSES.climbing.id) === true,
    rules: climbRules(), speed: climbingOf(token), room: room ? { ...room, remaining: finite(room.remaining) } : null, position: positionJson(token),
    falling: token.actor?.statuses?.has("falling") === true, checkedAt: token.getFlag(MODULE_ID, "climb")?.checkedAt ?? null,
    // Batch 2: on the ceiling?, can go there?, the capacity, the perch, the "On the ceiling" status, the vertical mirror.
    onCeiling: isOnCeiling(token), canCeiling: canClimbCeiling(token), walksCeilings: canWalkCeilings(token.actor),
    perch: ceilingPerchFor(token), ceiling: ceiling ? { perch: ceiling.perch, cells: ceiling.cells, affordable: ceiling.affordable } : null,
    ceilingStatus: token.actor?.statuses?.has(MODE_STATUSES.ceiling.id) === true, canDown: canClimbDown(token),
    scaleY: token._source.texture?.scaleY ?? 1, flip: token.getFlag(MODULE_ID, FLIP_FLAG) ?? null,
    // Batch 3 (§195): slippery surface, ceiling capacity here, "Run on the wall", speeds granted by the content.
    slippery: inSlipperyZone(token), walksCeilingsHere: canWalkCeilingsAt(token), canRun: acrobaticFor(token),
    fallReason: climbFallReasonFor(token) ?? null, movementAction: token.movementAction ?? null, statuses: Array.from(token.actor?.statuses ?? []),
    acrobatic: token.getFlag(MODULE_ID, "climb")?.acrobatic === true,
    grants: speedGrantEffects(token.actor).map(e => ({ id: e.id, name: e.name, changes: (e.system?.changes ?? e.changes ?? []).map(c => ({ key: c.key, value: c.value })) })),
    // §196 : ce que publie `api.climb.state`.
    api: climbStateOf(token) };
}

/** §209: pull up onto the ledge `dir` ("n", "s", "e", "w"; the first otherwise), like the menu entry. */
export async function hoist({ tokenId, dir=null }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const ledges = ledgesOf(token);
  const ledge = ledges.find(l => !dir || (l.dir === dir)) ?? null;
  const done = ledge ? await hoistOnto(token, ledge) : false;
  await sleep(800);
  return { done, ledges: ledges.map(({ dir, ground, rise, level }) => ({ dir, ground, rise, level })), before, after: positionJson(token),
    climbing: isClimbing(token) };
}

/** §216: "Grab the edge" toward `dir` (or the first edge), like the menu entry; returns the proposed edges and the position. */
export async function grab({ tokenId, dir=null }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const edges = edgesBelowOf(token);
  const edge = edges.find(e => !dir || (e.dir === dir)) ?? null;
  const done = edge ? await grabEdge(token, edge) : false;
  await sleep(800);
  return { done, edges: edges.map(({ dir, elevation, level, drop }) => ({ dir, elevation, level, drop })), before, after: positionJson(token),
    climbing: isClimbing(token) };
}

/** §196: `api.climb.holds` on a cell (`cell`: { i, j }) — would the climber hold there? */
export function climbHolds({ tokenId, cell }) {
  return { holds: climbHoldsAt(viewedToken({ tokenId }), cell) };
}

/** §196: `api.climb.toward` — climb up to a target's reach; returns its result, the positions and the (3D) gap before / after. */
export async function climbToward({ tokenId, targetId, reachCells=1 }) {
  const token = viewedToken({ tokenId });
  const target = viewedToken({ tokenId: targetId });
  const before = { ...positionJson(token), gap: gapCells(token, target), vertical: verticalGapCells(token, target) };
  const result = await climbTowardIntent(token, target, { reachCells });
  await sleep(300);
  const after = { ...positionJson(token), gap: gapCells(token, target), vertical: verticalGapCells(token, target) };
  return { result, before, after, ...climbState({ tokenId }) };
}

/** Climb `cells` cells, like the menu entry (without a window), and wait for the ascent; `acrobatic`: "Run on the wall" (§195). */
export async function climb({ tokenId, cells, acrobatic=false }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const done = await startClimb(token, { cells: Number.isFinite(cells) ? cells : null, acrobatic: acrobatic === true });
  return { done, before, after: positionJson(token), ...climbState({ tokenId }) };
}

/** §192 batch 2: "Climb the ceiling", like the menu entry, and wait for the ascent. */
export async function climbCeiling({ tokenId }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const done = await climbToCeiling(token);
  await sleep(300);
  return { done, before, after: positionJson(token), ...climbState({ tokenId }) };
}

/** §192 batch 2: "Climb down the wall" by `cells` cells, like the menu entry (without a window). */
export async function climbDown({ tokenId, cells }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const room = canClimbDown(token) ? descentRoom(token) : null;
  const done = await climbDownIntent(token, { cells: Number.isFinite(cells) ? cells : null });
  await sleep(300);
  return { done, before, after: positionJson(token), max: room?.max ?? null, ...climbState({ tokenId }) };
}

/**
 * §192 batch 2: what `tokenId`'s basic attack thinks of `targetId` — gap in cells (3D), vertical gap, too high for an
 * approach, and the range verdict; `engage: true` launches the basic attack like a click on the enemy (without a dialog) and says
 * whether the token moved and whether a card was created. `approach: true`: `api.approach({ target })` (the AI's walk, §179)
 * and its result.
 */
export async function reachCheck({ tokenId, targetId, engage: doEngage=false, approach: doApproach=false }) {
  const token = viewedToken({ tokenId });
  const target = viewedToken({ tokenId: targetId });
  const attack = basicAttack(token.actor);
  const reach = attack ? reachCells(attack.activity) : null;
  const out = {
    weapon: attack?.activity?.item?.name ?? null, reach, gap: gapCells(token, target), vertical: verticalGapCells(token, target),
    tooHigh: attack ? tooHighFor(token, target, reach) : null, status: attack ? rangeStatus(token, target, attack.activity) : null,
    before: positionJson(token)
  };
  if ( doApproach ) out.approach = await approach(token, { target, reachCells: reach?.normal ?? 1 });
  if ( doEngage && attack ) {
    const messages = game.messages.size;
    await engage(token, target, attack.activity, { fast: true });
    await sleep(500);
    out.engaged = { messages: game.messages.size - messages };
  }
  out.after = positionJson(token);
  out.moved = (out.after.x !== out.before.x) || (out.after.y !== out.before.y) || (out.after.elevation !== out.before.elevation);
  return out;
}

/**
 * §208: a jump like the menu entry ("Jump here", "High jump here"), toward the center of `cell`. Returns the before and
 * after positions, what the jump allowed (`options`, in feet), the warnings shown, and the turn budget (fixed jump, refund).
 */
export async function jump({ tokenId, cell, high=false }) {
  const token = viewedToken({ tokenId });
  const grid = token.parent.grid;
  const before = positionJson(token);
  const options = jumpOptionsOf(token);
  const warnings = [];
  const warn = ui.notifications.warn;
  ui.notifications.warn = (msg, ...rest) => { warnings.push(String(msg)); return warn.call(ui.notifications, msg, ...rest); };
  let result;
  try { result = await jumpTo(token, grid.getCenterPoint(grid.getTopLeftPoint(cell)), { high, configure: false }); }
  finally { ui.notifications.warn = warn; }
  await sleep(800);
  const combatant = token.actor ? combatantFor(token.actor) : null;
  const budget = combatant ? readBudget(combatant) : null;
  return { result: result ?? null, before, after: positionJson(token), warnings,
    options: { long: options.long, high: options.high, runningStart: options.runningStart, fixed: options.fixed, runUp: options.rules.runUp, useDex: options.rules.useDex },
    budget: budget ? { jumped: budget.jumped ?? 0, fixedJump: !!budget.fixedJump, jumpDouble: !!budget.jumpDouble } : null,
    statuses: Array.from(token.actor?.statuses ?? []) };
}

/** "Drop down": a voluntary fall, like the menu entry. */
export async function dropDown({ tokenId }) {
  const token = viewedToken({ tokenId });
  const before = positionJson(token);
  const done = await dropDownIntent(token);
  return { done, before, after: positionJson(token), hp: token.actor?.system?.attributes?.hp?.value ?? null, ...climbState({ tokenId }) };
}

/** §238: what the menu offers a token for flight (choices, labels); `run`: play it, like a click on the entry. */
export async function flight({ tokenId, run=false }) {
  const token = viewedToken({ tokenId });
  const choice = flightChoiceOf(token);
  const before = positionJson(token);
  const done = run ? await takeFlight(token, choice) : null;
  return { choice, entries: flightEntries(token).map(e => e.label), done, before, after: positionJson(token),
    fly: Number(token.actor?.system?.attributes?.movement?.fly) || 0, falling: token.actor?.statuses?.has("falling") === true,
    // What decides it (`flightChoiceOf`): to understand an empty menu.
    why: { owner: token.isOwner, creature: token.actor?.system?.isCreature !== false, pilot: !!pilotOf(token), ethereal: isEthereal(token),
      airborne: isAirborne(token), speeds: speedsOf(token.actor), bounds: { ...boundsUnder(token) }, altitude: game.settings.get(MODULE_ID, "altitude") } };
}
