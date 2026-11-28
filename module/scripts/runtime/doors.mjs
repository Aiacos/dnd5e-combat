/**
 * Doors (SPEC §18.24): open, close, and in front of a locked door, pick it, force it or open it with the key.
 * The state is read and written as the core does on a click on the door icon (canvas/containers/elements/door-control.mjs,
 * `_onMouseDown` / `_onRightDown`): `wall.document.ds`, updated by the client, "WALL_DOORS" permission required.
 *
 * §244 (issue #22): the lock set by the GM (adapter/locks.mjs, core/locks.mjs). The check is rolled on the player's side, visible;
 * the active GM judges it against the DC, which stays hidden, and unlocks (pick, key: closed) or opens (force). Without a DC: the
 * GM decides, as before. In combat, picking or forcing costs the action (Utilize). On the active GM's side, after the 3D dice,
 * three public hooks:
 *  - `dnd5e-combat.lockAttempt` `({ door, token, method, outcome, total })`: each judged attempt (§247), successful or not;
 *  - `dnd5e-combat.doorUnlocked` `({ door, token, method })`: the door has just been unlocked (`method`: pick, force, key);
 *  - `dnd5e-combat.noise` `({ token, point, scene, cause, wall })`: a noise (forcing a door, successful or not), for modules
 *    that make creatures hear (`api.vision.canHear`).
 */

import { MODULE_ID } from "../constants.mjs";
import { LOCK_FAILURE_MODES, judgeAttempt, alreadyTried, recordTry, lockChoices, stateAfter, triesKey, attemptReport } from "../core/locks.mjs";
import { LOCK_TRIES_FLAG, lockOf, triesOf, keyItemFor, doorPoint } from "../adapter/locks.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { GRATE_SETTING } from "../adapter/cover.mjs";
import { payAction } from "./action-end.mjs";
import { approachDoor } from "./actions.mjs";
import { log, loc, notice, say, esc, viaActiveGM, rolledAndShown } from "./shared.mjs";

export const LOCK_QUERY = `${MODULE_ID}.doorLock`;
export const LOCK_FAILURE_SETTING = "lockFailure";
/**
 * §244: on the active GM's side, when a locked door has just been opened by a successful attempt: `({ door, token, method })` —
 * `door` the WallDocument, `token` the TokenDocument, `method` "pick", "force" or "key". Read-only.
 */
export const DOOR_UNLOCKED_HOOK = `${MODULE_ID}.doorUnlocked`;
/**
 * §244: on the active GM's side, a noise to report to modules that make creatures hear: `({ token, point, scene, cause, wall })` —
 * today only `cause: "forceDoor"`, emitted on each attempt to force a door, before judging it. Read-only.
 */
export const NOISE_HOOK = `${MODULE_ID}.noise`;
/**
 * §247: on the active GM's side, after each attempt judged on a lock (pick, force, key): `({ door, token, method, outcome,
 * total })`, `outcome` "success", "failure" or "gm" (no DC: the GM decides). Read-only.
 */
export const LOCK_ATTEMPT_HOOK = `${MODULE_ID}.lockAttempt`;

/**
 * §247: on the active GM's side, each attempt judged on a lock (pick, force, key) — `({ door, token, method, outcome, total })`,
 * `outcome` success / failure / gm. For neighbouring modules (a trapped door that goes off on a failed pick); the engine expects
 * nothing from it.
 */
function announceAttempt(wall, token, method, outcome, total) {
  Hooks.callAll(LOCK_ATTEMPT_HOOK, { door: wall, token, ...attemptReport(method, outcome, total) });
}

const states = () => CONST.WALL_DOOR_STATES;

/** World setting: a failure costs nothing, or only one attempt per character. */
export function lockFailureMode() {
  try { return game.settings.get(MODULE_ID, LOCK_FAILURE_SETTING); } catch { return "free"; }
}

/** A door's state (placeable or document): "open", "closed" or "locked". */
export function doorState(wall) {
  const ds = wall?.document?.ds ?? wall?.ds;
  if ( ds === states().OPEN ) return "open";
  if ( ds === states().LOCKED ) return "locked";
  return "closed";
}

/** The core refuses to let players operate a door while paused; we do the same. */
function mayUse() {
  if ( !game.user.can("WALL_DOORS") ) return false;
  if ( game.paused && !game.user.isGM ) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return false;
  }
  return true;
}

/**
 * Open or close, after moving up to it (`approachDoor`). A locked door does not open: the sound of the handle that resists,
 * as on a core click.
 */
export async function setDoorOpen(token, wall, open) {
  if ( !mayUse() ) return;
  if ( !(await approachDoor(token, wall)) ) return;
  if ( doorState(wall) === "locked" ) {
    wall._playDoorSound?.("test");
    return ui.notifications.info(loc("Porte.Verrouillee"));
  }
  await wall.document.update({ ds: open ? states().OPEN : states().CLOSED });
}

/** GM: lock a closed door, or unlock it. Attempts already made on the lock start over from zero. */
export async function setDoorLocked(wall, locked) {
  if ( !game.user.isGM || (doorState(wall) === "open") ) return;
  await wall.document.update({ ds: locked ? states().LOCKED : states().CLOSED, [`flags.${MODULE_ID}.-=${LOCK_TRIES_FLAG}`]: null });
}

/** GM: reset the attempts made on this lock ("one attempt per character" setting). */
export async function resetLockTries(wall) {
  if ( !game.user.isGM ) return;
  await wall.document.unsetFlag(MODULE_ID, LOCK_TRIES_FLAG);
}

/** Have any attempts been recorded on this lock? */
export function hasLockTries(wall) {
  return Object.keys(triesOf(wall)).length > 0;
}

/**
 * The lock entries in front of a locked door, for this token: `{ method, spent }` (core/locks.mjs, `lockChoices`).
 * The key only appears if the character carries it; "Force" disappears for a door that cannot be forced.
 */
export function lockEntriesFor(token, wall) {
  const actor = token?.actor;
  const lock = lockOf(wall);
  return lockChoices(lock, { hasKey: !!keyItemFor(actor, lock), tries: triesOf(wall), who: triesKey(actor?.uuid), mode: lockFailureMode(),
    hasTools: hasThievesTools(actor) });
}

/**
 * O9d (§357): "picking a lock" requires Thieves' Tools (Player's Handbook 2024, Thieves' Tools) — a tool item with base
 * `thief`, or with identifier `thieves-tools`.
 */
function hasThievesTools(actor) {
  return Array.from(actor?.items ?? []).some(i => (i.type === "tool")
    && ((i.system?.type?.baseItem === "thief") || (identifierOf(i).id === "thieves-tools")));
}

/** O9d (§357): a carried Crowbar gives Advantage on Strength checks to force (Player's Handbook 2024, Crowbar). */
function hasCrowbar(actor) {
  // §406: via `identifierOf` — an item created in French without an identifier gets from dnd5e the one of its translated name
  // ("pied-de-biche").
  return Array.from(actor?.items ?? []).some(i => identifierOf(i).id === "crowbar");
}

/**
 * The check, on the player's side: `null` if it was cancelled. We wait for the 3D dice to stop (`waitForDice`, bounded): the
 * verdict, the door giving way and its animation (public hooks) only come after. dnd5e only renders rolls: the message is the last
 * roll message of this client created during the check.
 */
async function rollFor(actor, method, event) {
  const rolls = await rolledAndShown(() => (method === "pick")
    ? actor.rollToolCheck({ tool: "thief", ability: "dex", event }, { configure: false })
    : actor.rollSkill({ skill: "ath", ability: "str", event, ...(hasCrowbar(actor) ? { advantage: true } : {}) }, { configure: false }));
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? total : null;
}

const tokenUuid = token => token.document?.uuid ?? token.uuid;

/**
 * Pick (Player's Handbook 2024: "Utilize: pick a lock" — Dexterity check with Thieves' Tools; dnd5e
 * adds proficiency if the creature has it, actor.mjs `rollToolCheck`) or force (Strength (Athletics)). Moves up to the door, pays
 * the action in combat, rolls the check, then the active GM judges it.
 * @returns {Promise<string|null>}  "success", "failure", "gm", or null (nothing was attempted).
 */
async function attempt(token, wall, method, { event=null }={}) {
  const actor = token?.actor;
  if ( !actor || !mayUse() ) return null;
  if ( (method === "pick") && !hasThievesTools(actor) ) {
    ui.notifications.info(loc("Serrure.SansOutils", { name: token.name }));
    return null;
  }
  if ( alreadyTried(triesOf(wall), triesKey(actor.uuid), method, lockFailureMode()) ) {
    ui.notifications.info(loc("Serrure.DejaEssaye", { name: token.name }));
    return null;
  }
  if ( !(await approachDoor(token, wall)) ) return null;
  if ( doorState(wall) !== "locked" ) return null;
  if ( !(await payAction(token)) ) return null;
  const total = await rollFor(actor, method, event);
  if ( total === null ) return null;
  const result = await viaActiveGM(LOCK_QUERY, handleLockQuery, { wall: wall.document.uuid, token: tokenUuid(token), method, total },
    { noGm: "Serrure.SansMJ", fallback: null, label: "doors: lock attempt" });
  return result?.outcome ?? null;
}

export const pickLock = (token, wall, options) => attempt(token, wall, "pick", options);
export const forceDoor = (token, wall, options) => attempt(token, wall, "force", options);

/** Unlock with the key the character carries: no check or cost (interacting with an object). */
export async function unlockWithKey(token, wall) {
  if ( !token?.actor || !mayUse() ) return null;
  if ( !(await approachDoor(token, wall)) ) return null;
  const result = await viaActiveGM(LOCK_QUERY, handleLockQuery, { wall: wall.document.uuid, token: tokenUuid(token), method: "key" },
    { noGm: "Serrure.SansMJ", fallback: null, label: "doors: unlock with a key" });
  return result?.outcome ?? null;
}

/**
 * On the active GM's side: judge an attempt and unlock. Everything is re-checked here (door locked, token owned by the requester,
 * key carried, attempt not yet made). The check is the one the player rolled and everyone sees; its total arrives with the request.
 */
async function handleLockQuery({ wall: wallUuid, token: tokUuid, method, total }, { user=game.user }={}) {
  const wall = await fromUuid(wallUuid);
  const token = await fromUuid(tokUuid);
  const actor = token?.actor;
  if ( !wall || !actor || !["pick", "force", "key"].includes(method) ) return { outcome: null };
  if ( !user.isGM && !actor.testUserPermission(user, "OWNER") ) return { outcome: null };
  if ( doorState(wall) !== "locked" ) return { outcome: null };
  const lock = lockOf(wall);
  const value = Number(total);
  if ( method === "force" ) Hooks.callAll(NOISE_HOOK, { token, point: doorPoint(wall), scene: wall.parent, cause: "forceDoor", wall });
  let outcome;
  if ( method === "key" ) outcome = keyItemFor(actor, lock) ? "success" : "failure";
  else {
    const mode = lockFailureMode();
    const who = triesKey(actor.uuid);
    if ( alreadyTried(triesOf(wall), who, method, mode) ) return { outcome: null };
    outcome = judgeAttempt(lock, method, value);
    if ( outcome === "failure" ) {
      const tries = recordTry(triesOf(wall), who, method, mode);
      if ( tries[who] ) await wall.setFlag(MODULE_ID, LOCK_TRIES_FLAG, tries);
    }
  }
  const speaker = { actor, token };
  const name = esc(token.name);
  const shown = Number.isFinite(value) ? ` (${value})` : "";
  if ( outcome === "gm" ) {
    log(`${token.name}: ${method} the lock${shown} — no DC set, the GM decides`);
    announceAttempt(wall, token, method, outcome, value);
    return { outcome };
  }
  if ( outcome === "failure" ) {
    if ( method !== "key" ) await say(speaker, loc((method === "pick") ? "Serrure.CrochetageRate" : "Serrure.ForcageRate", { name }));
    // §252: the failure is seen and heard by everyone (floating text, sound of the lock that resists).
    notice(token, { key: { pick: "Retour.Action.SerrureRatee", force: "Retour.Action.PorteResiste", key: "Retour.Action.PasLaCle" }[method] },
      "refused", { all: true, action: method, outcome: "failure" });
    log(`${token.name}: ${method} the lock fails${shown}`);
    announceAttempt(wall, token, method, outcome, value);
    return { outcome };
  }
  const key = keyItemFor(actor, lock);
  const ds = (stateAfter(method) === "open") ? states().OPEN : states().CLOSED;
  await wall.update({ ds, [`flags.${MODULE_ID}.-=${LOCK_TRIES_FLAG}`]: null });
  const text = { pick: "Serrure.Crochetee", force: "Serrure.Forcee", key: "Serrure.OuverteCle" }[method];
  await say(speaker, loc(text, { name, key: esc(key?.name ?? "") }));
  notice(token, { key: "Serrure.Deverrouillee" }, "gain", { all: true, action: method, outcome: "success" });   // §252 : chez tous, avec son
  log(`${token.name}: door unlocked (${method}${shown})`);
  announceAttempt(wall, token, method, outcome, value);
  Hooks.callAll(DOOR_UNLOCKED_HOOK, { door: wall, token, method });
  return { outcome };
}

export function registerDoors() {
  game.settings.register(MODULE_ID, LOCK_FAILURE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${LOCK_FAILURE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${LOCK_FAILURE_SETTING}.Aide`,
    scope: "world", config: true, type: String, default: "free",
    choices: Object.fromEntries(LOCK_FAILURE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${LOCK_FAILURE_SETTING}.${m}`]))
  });
  // §476: walls are grates by default (return from Fanarie) — read by adapter/cover.mjs, `isGrate`.
  // No reload: read on every ray.
  game.settings.register(MODULE_ID, GRATE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${GRATE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${GRATE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false
  });
  CONFIG.queries[LOCK_QUERY] = handleLockQuery;
}

/** Pour les fonctions de test (runtime/testing-moves.mjs). */
export { handleLockQuery };
