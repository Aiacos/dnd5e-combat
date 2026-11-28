/**
 * §290: the questions put to a player when the combat windows have no time limit (world setting `combatWindowUnlimited`).
 * The client that asks the question (usually the active GM) waits as long as it takes; on a GM's client, each wait is noted here
 * — who, for which character, what, since when — for its tracking window (ui/player-waits.mjs). "Force" asks the player's
 * client to resolve its windows as at the end of the timeout (`forceOpenWindows`, adapter/dialogs.mjs): the question comes back
 * with the default answer. A player who disconnects: the question fails at once, like a missing answer.
 *
 * Windows with a timeout (default setting): the core request with that timeout (`user.query`, client/documents/user.mjs);
 * §381: noted too, so the GM can force from the token menu.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { forceOpenWindows, windowsUnlimited } from "./dialogs.mjs";

export const FORCE_WINDOWS_QUERY = `${MODULE_ID}.forceWindows`;
/**
 * §290: on the client that asks a player a question (usually the active GM), when a wait starts or ends: `(waits)`,
 * `[{ id, userId, userName, actor, actorName, img, label, since }]`. Read-only; the same list: `api.waits.list()`.
 */
export const PLAYER_WAITS_HOOK = `${MODULE_ID}.playerWaits`;

/** Without a timeout, a question waits at most this long (the game was left in the meantime, not a player who is thinking). */
const UNLIMITED_TIMEOUT = 3 * 60 * 60 * 1000;
/** After "Force", the question is dropped if it has not come back (window already closed, frozen client). */
const FORCE_GRACE_MS = 4000;

/** Les attentes en cours sur ce client : id → `{ id, userId, actor, label, since, abandon }`. */
const waits = new Map();

const changed = () => Hooks.callAll(PLAYER_WAITS_HOOK, playerWaits());

/** Les attentes en cours, la plus ancienne d'abord. */
export function playerWaits() {
  return [...waits.values()].map(({ abandon, ...w }) => w).sort((a, b) => a.since - b.since);
}

/**
 * Asks the player `user` the question `name`, noted for the GM's tracking. With a timeout: the core request, with that timeout.
 * Without: waits with no limit.
 * Throws like `user.query` when there is no answer (player gone, question dropped).
 * @param {User} user
 * @param {string} name     The request (`CONFIG.queries`).
 * @param {object} payload
 * @param {object} options
 * @param {number} options.timeout       The request timeout when the windows have one.
 * @param {Actor|null} [options.actor]   The character concerned.
 * @param {string} [options.label]       What the player sees ("Reaction", "Shield"…), already translated.
 */
export async function queryPlayer(user, name, payload, { timeout, actor=null, label="" }={}) {
  // §381: noted too when the windows have a timeout — the GM can force from the token menu without waiting for the countdown.
  const unlimited = windowsUnlimited();
  const id = foundry.utils.randomID();
  const { promise: abandoned, reject: abandon } = Promise.withResolvers();
  waits.set(id, { id, userId: user.id, userName: user.name, actor: actor?.uuid ?? null, actorName: actor?.name ?? "",
    img: actor?.img ?? null, label: String(label ?? ""), since: Date.now(), abandon });
  changed();
  // A player who leaves will not answer anymore: like a missing answer.
  const watch = setInterval(() => { if ( !user.active ) abandon(new Error(`${user.name} disconnected`)); }, 1000);
  try { return await Promise.race([user.query(name, payload, { timeout: unlimited ? UNLIMITED_TIMEOUT : timeout }), abandoned]); }
  finally {
    clearInterval(watch);
    waits.delete(id);
    changed();
  }
}

/**
 * The GM forces the wait `id`: the player's client resolves its combat windows as at the end of the timeout.
 * Returns false if it no longer exists.
 * @param {string} id
 */
export async function forcePlayerWait(id) {
  const wait = waits.get(id);
  if ( !wait ) return false;
  const user = game.users.get(wait.userId);
  try { if ( user?.active ) await user.query(FORCE_WINDOWS_QUERY, {}, { timeout: FORCE_GRACE_MS }); }
  catch(err) { console.warn(`${MODULE_ID} | forcing ${wait.userName}'s windows`, err); }
  // The default answer comes back by itself; otherwise (no window open on their side), the question is dropped.
  setTimeout(() => waits.get(id)?.abandon(new Error(`forced by the GM`)), FORCE_GRACE_MS);
  return true;
}

/** On the player's side: the GM forces (request `FORCE_WINDOWS_QUERY`). Returns the number of windows resolved. */
export function handleForceWindows(data, { user=null }={}) {
  // §472: only the GM sends this request in the game; from a player, it is dropped (safety refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | forceWindows query from ${user.name} refused: only a GM sends it`); return 0; }
  return forceOpenWindows();
}

/** What the player sees, for the tracking window (`DND5ECOMBAT.Attente.Quoi.<key>`). */
export function waitLabel(key, data={}) {
  return game.i18n.format(`DND5ECOMBAT.Attente.Quoi.${key}`, data);
}
