/**
 * §421: the "GM queue" — everything that waits for someone, sorted for the GM into three parts:
 *  - `mine`: what the engine asks of the GM (a window open on a GM's client);
 *  - `players`: the players being waited for (a window open on theirs, or a question put to them);
 *  - `blocked`: an action whose author is no longer there to roll their dice.
 *
 * Two sources overlap: the table of waits broadcast by each client (core/awaiting.mjs — every Reaction, choice or roll window,
 * wherever it is open, without saying what it asks) and the questions this client put to a player
 * (adapter/player-wait.mjs — they say what, but exist only on the client that asks them). The queue keeps one line per window and
 * gives it the label of the question when there is one.
 *
 * §422: two details that only this client knows.
 *  - `prompts`: the windows open on this workstation (adapter/dialogs.mjs) — their text and their buttons, so that the GM
 *    answers from the queue what the engine asks of them (`prompt` on the `mine` line);
 *  - `groupRolls`: the requested rolls still awaited (§242). §423: a roll request already has its tracking window
 *    ("Rolls in progress"), with one card per character; the queue does not repeat its detail — ONE line per request
 *    (`source: "group"`), which says the check and how many characters are awaited, and points to the tracking. The roll
 *    windows of those characters have no other line.
 *
 * Pure: no dependency on Foundry.
 */

/** Does a question put to this player for this actor (or with no known actor) shed light on this wait? */
const matches = (entry, wait) => (wait.userId === entry.userId) && (!entry.actor || !wait.actor || (wait.actor === entry.actor));

/**
 * @param {object} sources
 * @param {object[]} [sources.awaiting]    The waits known to this client (`awaitingList()`).
 * @param {object[]} [sources.waits]       The questions put by this client (`playerWaits()`).
 * @param {object[]} [sources.blocked]    Rolls owed, author absent: `{ messageId, userId, userName, actor, actorName, item, heal }`
 * @param {object[]} [sources.prompts]     The windows open on this workstation: `{ id, awaitingId, title, text, buttons }`.
 * @param {object[]} [sources.groupRolls]  The requested rolls still awaited: `{ messageId, actor, label }`.
 * @param {object} [sources.labels]        §426: what the windows ask, by wait identifier — known to GMs only.
 * @returns {{mine: object[], players: object[], blocked: object[], count: number}}
 *   A line: `{ id, source: "awaiting"|"wait", userId, userName, actor, kind, label, since, seconds, waitIds, prompt, groupRoll }`.
 */
export function gmQueue({ awaiting=[], waits=[], blocked=[], prompts=[], groupRolls=[], labels={} }={}) {
  const used = new Set();
  const line = entry => {
    const own = waits.filter(w => matches(entry, w));
    for ( const w of own ) used.add(w.id);
    const prompt = prompts.find(p => p.awaitingId === entry.id) ?? null;
    const asked = ((entry.kind === "roll") && entry.actor) ? (groupRolls.find(g => g.actor === entry.actor) ?? null) : null;
    return {
      id: entry.id, source: "awaiting", userId: entry.userId, userName: entry.userName ?? "", actor: entry.actor ?? null,
      kind: entry.kind ?? "choice", label: own.find(w => w.label)?.label ?? asked?.label ?? prompt?.title ?? labels[entry.id] ?? "",
      since: entry.since ?? 0, seconds: entry.seconds ?? null, waitIds: own.map(w => w.id),
      prompt: prompt ? { id: prompt.id, text: prompt.text ?? "", buttons: prompt.buttons ?? [] } : null,
      groupRoll: asked?.messageId ?? null
    };
  };
  const mine = awaiting.filter(e => e.gm).map(line);
  const players = awaiting.filter(e => !e.gm).map(line);
  // A question whose window is not (yet) announced by the player's client: it keeps its line.
  for ( const w of waits ) {
    if ( used.has(w.id) ) continue;
    players.push({ id: `wait:${w.id}`, source: "wait", userId: w.userId, userName: w.userName ?? "", actor: w.actor ?? null,
      kind: "choice", label: w.label ?? "", since: w.since ?? 0, seconds: null, waitIds: [w.id], prompt: null, groupRoll: null });
  }
  // §423: the requested rolls — one line per request. The lines of their roll windows merge into it (they give the awaited players
  // and since when); the awaited characters come from the request's card, whether a window is announced or not.
  const requests = new Map();
  for ( const g of groupRolls ) {
    const group = requests.get(g.messageId) ?? { id: `group:${g.messageId}`, source: "group", userId: null, userName: "", actor: null, kind: "roll",
      label: g.label ?? "", since: g.since ?? 0, seconds: null, waitIds: [], prompt: null, groupRoll: g.messageId, actors: [], users: [] };
    if ( !group.actors.includes(g.actor) ) group.actors.push(g.actor);
    requests.set(g.messageId, group);
  }
  for ( let n = players.length - 1; n >= 0; n-- ) {
    const group = players[n].groupRoll ? requests.get(players[n].groupRoll) : null;
    if ( !group ) continue;
    const [gone] = players.splice(n, 1);
    if ( gone.userName && !group.users.includes(gone.userName) ) group.users.unshift(gone.userName);
    if ( gone.since && (!group.since || (gone.since < group.since)) ) group.since = gone.since;
  }
  for ( const group of requests.values() ) players.push({ ...group, userName: group.users.join(", "), count: group.actors.length });
  const bySince = (a, b) => (a.since - b.since) || String(a.id).localeCompare(String(b.id));
  mine.sort(bySince);
  players.sort(bySince);
  const stuck = blocked.map(b => ({ ...b, id: `blocked:${b.messageId}` }));
  return { mine, players, blocked: stuck, count: mine.length + players.length + stuck.length };
}

/** A fingerprint of the queue: it changes only if a line arrives, leaves, or gains its label or buttons (not with time). */
export function queueSignature(queue) {
  return [...queue.mine, ...queue.players, ...queue.blocked]
    .map(l => `${l.id}|${l.label ?? ""}|${l.prompt?.id ?? ""}|${l.groupRoll ?? ""}|${l.count ?? ""}`).join(";");
}
