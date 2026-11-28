/**
 * §381 (issue #35): who the table is waiting for. The client on which a reaction, choice or roll window is open tells all the
 * others; each keeps the list of known waits and publishes it (hook `dnd5e-combat.awaiting`, `api.ui.awaiting()`).
 * The engine names no neighbor: the hourglass above the token (ui/awaiting.mjs), the portraits of a neighboring interface,
 * read this list.
 *
 * Broadcast through the core's queries (`user.query`, client/documents/user.mjs), like the timers of §272: no module socket,
 * nothing is written into a document. What goes out never says what the window asks (core/awaiting.mjs, `awaitingEntry`).
 *
 * End of a wait: `release()` (answer, timeout, cancellation, forced answer — called in a `finally`); the disconnection of whoever
 * answers (core hook `userConnected`, runtime/awaiting.mjs); failing that, forgetting a wait that has no more news (core).
 */

import { MODULE_ID } from "../constants.mjs";
import { applyAwaiting, awaitingEntry, gmLabel, pruneAwaiting } from "../core/awaiting.mjs";

export const AWAITING_QUERY = `${MODULE_ID}.awaiting`;
/**
 * §381: on each client, on each change of the list of waits it knows (a reaction, choice or roll window
 * opened or closed somewhere, a wait forgotten): `(entries)`, the waits in progress, oldest first —
 * `{ id, userId, userName, token, actor, kind, gm, player, since, seconds, refreshed }`, never what the window asks. Read-only;
 * the same list: `api.ui.awaiting()`.
 */
export const AWAITING_HOOK = `${MODULE_ID}.awaiting`;

/** The waits open on THIS client (those it broadcasts): id → entry. */
const mine = new Map();
/** Toutes les attentes connues de ce client, la sienne comprise. */
let known = [];

const publish = () => Hooks.callAll(AWAITING_HOOK, awaitingList());

/** The waits in progress known to this client, oldest first (public form, without what the window asks). */
export function awaitingList() {
  known = pruneAwaiting(known, Date.now());
  return known.map(e => ({ ...e }));
}

/** Forget expired waits; publish if any dropped. */
export function pruneKnown() {
  const before = known.length;
  known = pruneAwaiting(known, Date.now());
  if ( known.length !== before ) publish();
}

/** Changer le tableau de ce client et le publier. */
export function changeAwaiting(change) {
  known = applyAwaiting(known, change);
  publish();
}

/** The waits open on this client (to refresh them, or answer a client that arrives). */
export const ownAwaiting = () => [...mine.values()];

/**
 * §426: what a window asks, for GMs only. The wait broadcast to the table never says it (core/awaiting.mjs); the
 * label goes separately, to connected GMs only, and a client that is not a GM does not keep it even if it received it.
 *  - `ownLabels`: those of the waits open on this client (for a GM who arrives);
 *  - `knownLabels`: those this client knows, its own included — filled on a GM only.
 */
const ownLabels = new Map();
const knownLabels = new Map();

/** §426: the labels known to this client, by wait id — empty on a player. */
export function awaitingLabels() {
  const alive = new Set(known.map(e => e.id));
  for ( const id of [...knownLabels.keys()] ) if ( !alive.has(id) ) knownLabels.delete(id);
  return Object.fromEntries(knownLabels);
}

function sendLabel(id, label, to=null) {
  for ( const user of (to ? [to] : game.users) ) {
    if ( !user.active || user.isSelf || !user.isGM ) continue;
    user.query(AWAITING_QUERY, { type: "label", id, label }, { timeout: 5000 }).catch(() => {});
  }
}

function send(payload) {
  for ( const user of game.users ) {
    if ( !user.active || user.isSelf ) continue;
    user.query(AWAITING_QUERY, payload, { timeout: 5000 }).catch(() => {});
  }
}

/** Broadcasts all this client's waits again (refresh: they are not forgotten). */
export function refreshAwaiting() {
  if ( !mine.size ) return;
  const now = Date.now();
  for ( const entry of mine.values() ) entry.refreshed = now;
  changeAwaiting({ type: "replace", userId: game.user.id, list: ownAwaiting() });
  send({ type: "replace", userId: game.user.id, list: ownAwaiting() });
}

/** The token of an actor on the displayed scene (an unlinked token is its own). */
function tokenOf(actor, token) {
  // `getActiveTokens(false, true)` returns TokenDocuments; a canvas Token carries its own in `document`.
  const found = token ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  return (found?.document ?? found)?.uuid ?? null;
}

/**
 * A window that makes the table wait has just opened on this client. Returns `release()`, to call when it closes for whatever
 * reason (no effect the second time).
 * @param {Actor|null} actor   The creature concerned (the one reacting, choosing or rolling the dice).
 * @param {"reaction"|"choice"|"roll"} kind
 * @param {{seconds?: number|null, token?: TokenDocument|Token|null}} [options]  `seconds`: the window's timeout, if there is one.
 * @returns {() => void}
 */
export function markAwaiting(actor, kind, { seconds=null, token=null, label=null }={}) {
  if ( !game?.user ) return () => {};
  const now = Date.now();
  const entry = awaitingEntry({
    id: foundry.utils.randomID(), userId: game.user.id, userName: game.user.name,
    token: tokenOf(actor, token), actor: actor?.uuid ?? null, kind,
    gm: game.user.isGM === true, player: actor?.hasPlayerOwner === true,
    since: now, seconds, refreshed: now
  });
  if ( !entry ) return () => {};
  mine.set(entry.id, entry);
  changeAwaiting({ type: "add", entry });
  send({ type: "add", entry });
  // §426: what the window asks, to GMs only.
  const told = gmLabel(label);
  if ( told ) {
    ownLabels.set(entry.id, told);
    if ( game.user.isGM ) knownLabels.set(entry.id, told);
    sendLabel(entry.id, told);
  }
  let released = false;
  const release = () => {
    if ( released ) return;
    released = true;
    mine.delete(entry.id);
    ownLabels.delete(entry.id);
    knownLabels.delete(entry.id);
    changeAwaiting({ type: "remove", id: entry.id });
    send({ type: "remove", id: entry.id });
  };
  release.id = entry.id;   // §422: to link the open window to its line in the GM queue
  return release;
}

/**
 * `fn()` while a wait is displayed; it drops when `fn` finishes, success or error.
 * @template T
 * @param {Actor|null} actor
 * @param {"reaction"|"choice"|"roll"} kind
 * @param {() => Promise<T>|T} fn
 * @param {{seconds?: number|null, token?: object}} [options]
 * @returns {Promise<T>}
 */
export async function whileAwaiting(actor, kind, fn, options={}) {
  const release = markAwaiting(actor, kind, options);
  try { return await fn(); }
  finally { release(); }
}

/**
 * On each client: a wait from another arrives, leaves, or a client gives all of its own. `sync`: an arriving client asks
 * for the waits open here (returned as they are).
 */
export function receiveAwaiting(payload={}, { user }={}) {
  if ( payload.type === "sync" ) {
    // §426: an arriving GM also receives the labels of the waits open here.
    if ( user?.isGM ) for ( const [id, label] of ownLabels ) sendLabel(id, label, user);
    return ownAwaiting();
  }
  if ( payload.type === "label" ) {
    // Kept by a GM only, and only for a wait of the sender.
    const entry = known.find(e => e.id === payload.id);
    if ( !game.user.isGM || !entry || (user && (entry.userId !== user.id)) ) return false;
    const told = gmLabel(payload.label);
    if ( !told ) return false;
    knownLabels.set(entry.id, told);
    publish();
    return true;
  }
  // Un client ne parle que de ses propres attentes.
  const from = user?.id ?? null;
  if ( payload.type === "add" ) {
    if ( from && (payload.entry?.userId !== from) ) return false;
    changeAwaiting({ type: "add", entry: payload.entry });
  }
  else if ( payload.type === "remove" ) {
    const entry = known.find(e => e.id === payload.id);
    if ( entry && from && (entry.userId !== from) ) return false;
    changeAwaiting({ type: "remove", id: payload.id });
  }
  else if ( payload.type === "replace" ) {
    if ( from && (payload.userId !== from) ) return false;
    changeAwaiting({ type: "replace", userId: payload.userId, list: payload.list });
  }
  return true;
}

/** An arriving client: asks the other connected clients for their open waits. */
export async function syncAwaiting() {
  await Promise.all([...game.users].filter(u => u.active && !u.isSelf).map(async user => {
    const list = await user.query(AWAITING_QUERY, { type: "sync" }, { timeout: 5000 }).catch(() => null);
    if ( Array.isArray(list) ) changeAwaiting({ type: "replace", userId: user.id, list });
  }));
}

/** For the engine's tests (`api.mcp`): this client's waits, and the markers placed by hand. */
export const testing = { mine: ownAwaiting };
