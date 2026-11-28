/**
 * §421: the "GM Queue" (core/gm-queue.mjs) on the Foundry side — what the GM must decide, the players they are waiting for, the
 * actions blocked by an author who left; and its two gestures: forcing a player's window, rolling in place of an absentee.
 *
 * Complement to the return to the table, not its replacement: the hourglass above the tokens and the banner "The GM is deciding…"
 * (ui/awaiting.mjs) tell the players someone is awaited; the queue tells the GM who, for what, and gives them control.
 *
 * Forcing: every combat window open on a client registers there (`expireLater`, adapter/dialogs.mjs), whether it comes from a GM
 * question or opened by itself on the author's side (click damage, smite, Sneak Attack, Critical Hit): the GM asks the player's
 * client to resolve them as at the end of the delay. Before this §, only the questions asked by the GM had a line to force;
 * a window opened on the author's side, with no delay, had no way out.
 */
import { MODULE_ID } from "../constants.mjs";
import { gmQueue, queueSignature } from "../core/gm-queue.mjs";
import { AWAITING_HOOK, awaitingList, awaitingLabels } from "../adapter/awaiting.mjs";
import { FORCE_WINDOWS_QUERY, PLAYER_WAITS_HOOK, forcePlayerWait, playerWaits } from "../adapter/player-wait.mjs";
import { combatWindowSeconds, windowsUnlimited, PROMPTS_HOOK, localPrompts, answerPrompt } from "../adapter/dialogs.mjs";
import { requestOf, viewOf, testTitle } from "../adapter/group-roll.mjs";
import { forceGroupRoll } from "./group-roll.mjs";
import { blockedRolls, rollForAbsent } from "./engine.mjs";
import { route } from "./router.mjs";
import { log, notice, tokenOfActor, isExecutor } from "./shared.mjs";

/**
 * §421: on a GM, when a line of their queue arrives, leaves or gets its label: `(queue)`, `{ mine, players, blocked, count }` —
 * what the engine asks of them, the players awaited, the actions whose author left. A line:
 * `{ id, userId, userName, actor, kind, label, since, seconds, waitIds }`. Read-only; the same queue: `api.queue.list()`.
 */
export const GM_QUEUE_HOOK = `${MODULE_ID}.gmQueue`;

/** The delay left to a player's client to resolve their windows when the GM forces. */
const FORCE_GRACE_MS = 4000;

/**
 * GM: the queue — `{ mine, players, blocked, count }` (what the engine asks of them, the players awaited, the actions whose author
 * left); empty on a player. A line: `{ id, userId, userName, actor, kind, label, since, seconds, waitIds }`.
 */
export function queue() {
  if ( !game.user?.isGM ) return gmQueue();
  return gmQueue({ awaiting: awaitingList(), waits: playerWaits(), blocked: blockedRolls(), prompts: localPrompts(), groupRolls: pendingGroupRolls(),
    labels: awaitingLabels() });
}

/** §422: the rolls requested by the GM (§242) that someone has not yet made — `{ messageId, actor, label }`, among the latest messages. */
function pendingGroupRolls() {
  const pending = [];
  for ( const message of game.messages?.contents.slice(-GROUP_LOOKBACK) ?? [] ) {
    if ( !requestOf(message) ) continue;
    const view = viewOf(message);
    for ( const entry of view?.entries ?? [] ) {
      if ( entry.status !== "rolled" ) pending.push({ messageId: view.id, actor: entry.uuid, label: testTitle(view.request), since: message.timestamp ?? 0 });
    }
  }
  return pending;
}
const GROUP_LOOKBACK = 50;

let last = "";
/**
 * Recomputes the queue; when it differs from the last one announced, `GM_QUEUE_HOOK` fires. Returns the queue (empty at a player).
 * 2026-11-28 (badge left at "1" on an empty queue): every reader that shows the queue goes through here, so what it shows and what
 * the next change is compared with are the same snapshot — the toolbar badge used to recompute on its own at each toolbar render
 * without moving `last`, and a line that came and went between two announcements left it lit for good.
 */
export function refreshQueue() {
  if ( !game.user?.isGM ) return gmQueue();
  const now = queue();
  const signature = queueSignature(now);
  if ( signature !== last ) {
    last = signature;
    Hooks.callAll(GM_QUEUE_HOOK, now);
  }
  return now;
}
const changed = () => { refreshQueue(); };

/**
 * Chat messages carry two parts of the queue (the requested rolls, §423, and the rolls due by an absent author, §421): a message created,
 * changed or deleted may add or remove a line. Grouped: one refresh after a burst of messages.
 */
let chatTimer = null;
function chatChanged() {
  if ( !game.user?.isGM ) return;
  clearTimeout(chatTimer);
  chatTimer = setTimeout(() => { chatTimer = null; refreshQueue(); }, CHAT_REFRESH_MS);
}
const CHAT_REFRESH_MS = 100;

/**
 * The GM forces line `id` of "I'm waiting for a player": its window closes on their side with the answer the delay would
 * have given. The table sees it (text above the token). Returns false if the line no longer exists, or on a player.
 * @param {string} id
 */
export async function forceLine(id) {
  if ( !game.user.isGM ) return false;
  const line = queue().players.find(l => l.id === id);
  if ( !line ) return false;
  // §423: a roll request — "Roll for the laggards", like the roll tracking window: each roll is made here.
  if ( line.source === "group" ) {
    log(`group roll forced from the GM queue (${line.label}, ${line.actors.length} waiting)`);
    let rolled = false;
    for ( const actor of line.actors ) rolled = (await forceGroupRoll(line.groupRoll, actor)) || rolled;
    changed();
    return rolled;
  }
  const actor = line.actor ? await fromUuid(line.actor) : null;
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: "Attente.Avis", data: { name: line.userName } }, "refused", { all: true, action: "forced", outcome: "success" });
  log(`${line.userName}'s window forced by the GM (${line.label || line.kind})`);
  // §422: a requested roll — "Roll for them", like the roll tracking window: the roll is made here, its window closes on theirs.
  if ( line.groupRoll ) return forceGroupRoll(line.groupRoll, line.actor);
  // A question asked by this client: it knows how to let go if the answer does not come back (adapter/player-wait.mjs).
  if ( line.waitIds.length ) {
    for ( const waitId of line.waitIds ) await forcePlayerWait(waitId);
    return true;
  }
  const user = game.users.get(line.userId);
  try { if ( user?.active ) await user.query(FORCE_WINDOWS_QUERY, {}, { timeout: FORCE_GRACE_MS }); }
  catch(err) { console.warn(`${MODULE_ID} | forcing ${line.userName}'s windows`, err); }
  return true;
}

/**
 * §422: the GM answers from their queue to what the engine asks of them — the `action` button of the window of line `id` of `mine`,
 * as if they had clicked it in the window. Returns false if the line has no window (any more) on this workstation.
 * @param {string} id
 * @param {string} action
 */
export function answerLine(id, action) {
  if ( !game.user.isGM ) return false;
  const line = queue().mine.find(l => l.id === id);
  return line?.prompt ? answerPrompt(line.prompt.id, action) : false;
}

/**
 * The GM rolls in place of an author who left the roll owed by line `id` of "Blocked" (or the identifier of its message).
 * Active GM.
 * @param {string} id
 */
export async function rollBlocked(id) {
  const done = await rollForAbsent(String(id ?? "").replace(/^blocked:/, ""));
  changed();
  return done;
}

export function registerGmQueue() {
  const always = { always: true };
  route(AWAITING_HOOK, changed, { ...always, label: "GM queue: not refreshed (awaiting)" });
  route(PLAYER_WAITS_HOOK, changed, { ...always, label: "GM queue: not refreshed (waits)" });
  route(PROMPTS_HOOK, changed, { ...always, label: "GM queue: not refreshed (windows of this client)" });
  // A resolution that moves on may lift a block (the roll arrived).
  // A resolution that moves on may lift a block; a requested roll's card gets its results; a message deleted takes its lines away.
  route("createChatMessage", chatChanged, { ...always, label: "GM queue: not refreshed (new message)" });
  route("updateChatMessage", chatChanged, { ...always, label: "GM queue: not refreshed (message changed)" });
  route("deleteChatMessage", chatChanged, { ...always, label: "GM queue: not refreshed (message deleted)" });
  route("userConnected", (user, connected) => {
    changed();
    if ( connected || !isExecutor() ) return;
    // "Combat windows do not hold up the game": with a delay, the roll that a departed player owed is made for them at the end
    // of that delay. Without a delay, the GM decides, from their queue ("Blocked").
    if ( windowsUnlimited() ) return;
    setTimeout(async () => {
      if ( game.users.get(user.id)?.active ) return;   // back in the meantime: it's up to them
      for ( const stuck of blockedRolls().filter(b => b.userId === user.id) ) {
        log(`${user.name} left with a roll due (${stuck.item}): rolled for them`);
        await rollForAbsent(stuck.messageId);
      }
      changed();
    }, combatWindowSeconds() * 1000);
  }, { ...always, label: "GM queue: a roll due by a player who left" });
}
