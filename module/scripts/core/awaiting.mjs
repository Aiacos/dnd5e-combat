/**
 * §381 (issue #35): who the table is waiting for — a reaction, choice or roll window open for a player or for the GM. What is
 * computed without Foundry: the shape of a broadcast wait (never what it asks), its expiry, and where each client shows it.
 *
 * Pure: no dependency on Foundry.
 */

/** The kinds of wait: a reaction, a choice (option, confirmation), a dice roll. */
export const AWAITING_KINDS = Object.freeze(["reaction", "choice", "roll"]);

/** The waiting client refreshes its waits at this rate; a wait not refreshed since `AWAITING_STALE_MS` is forgotten. */
export const AWAITING_REFRESH_MS = 20000;
export const AWAITING_STALE_MS = 60000;
/** After the announced end of a window with a delay (the time it takes to resolve itself), its wait drops by itself. */
export const AWAITING_GRACE_MS = 5000;

/** The modes of the `awaitingGm` setting: a GM window for a creature without a player. */
export const AWAITING_GM_MODES = Object.freeze(["discreet", "token", "hidden"]);

/**
 * The broadcast shape of a wait: nothing but these fields — neither the name of the reaction, nor the item, nor the prompt.
 * @param {object} raw
 * @returns {{id: string, userId: string, userName: string, token: string|null, actor: string|null, kind: string, gm: boolean,
 *   player: boolean, since: number, seconds: number|null, refreshed: number}|null}  null if the wait is unusable.
 */
export function awaitingEntry(raw={}) {
  const id = String(raw.id ?? "");
  const userId = String(raw.userId ?? "");
  if ( !id || !userId ) return null;
  const since = Number.isFinite(raw.since) ? raw.since : 0;
  const seconds = Number(raw.seconds) > 0 ? Number(raw.seconds) : null;
  return {
    id, userId, userName: String(raw.userName ?? ""),
    token: raw.token ? String(raw.token) : null,
    actor: raw.actor ? String(raw.actor) : null,
    kind: AWAITING_KINDS.includes(raw.kind) ? raw.kind : "choice",
    gm: raw.gm === true,
    player: raw.player === true,
    since, seconds,
    refreshed: Number.isFinite(raw.refreshed) ? raw.refreshed : since
  };
}

/**
 * §426: the label of a wait reserved for GMs (the window title: "Heroic Inspiration — Paladin"). It is NOT part of
 * the broadcast wait (`awaitingEntry` does not keep it): it travels apart, to the GMs only, for their Queue. One line,
 * 80 characters at most; empty string if nothing usable.
 */
export function gmLabel(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return (clean.length > 80) ? `${clean.slice(0, 79)}…` : clean;
}

/** Is a wait still valid at `now`? Neither forgotten (no news), nor past the end of its delay. */
export function awaitingAlive(entry, now) {
  if ( !entry ) return false;
  if ( (now - entry.refreshed) > AWAITING_STALE_MS ) return false;
  if ( entry.seconds && ((now - entry.since) > ((entry.seconds * 1000) + AWAITING_GRACE_MS)) ) return false;
  return true;
}

/** What remains of the delay, from 1 (just opened) to 0; null without a delay. */
export function awaitingLeft(entry, now) {
  if ( !entry?.seconds ) return null;
  const total = entry.seconds * 1000;
  return Math.max(0, Math.min(1, 1 - ((now - entry.since) / total)));
}

/**
 * Where this client shows the wait.
 *  - `none`: nothing (it is the one answering, or the table turned the indicator off, or the GM keeps it for themself);
 *  - `token`: the hourglass above the token;
 *  - `banner`: the discreet banner "The GM is deciding…", without designating a creature.
 * A GM window for a creature without a player would reveal that it has a Reaction or an option: the `gmMode` setting decides what
 * the players see of it. The GM sees everything on the tokens. A GM window for a player character (player absent) is not
 * a secret: on the token.
 * @param {object} entry
 * @param {{userId: string, isGM: boolean, enabled?: boolean, hidden?: boolean, gmMode?: string}} viewer
 * @returns {"none"|"token"|"banner"}
 */
export function awaitingPlacement(entry, { userId, isGM, enabled=true, hidden=false, gmMode="discreet" }) {
  if ( !entry || !enabled || hidden ) return "none";
  if ( entry.userId === userId ) return "none";
  const secret = entry.gm && !entry.player;
  if ( !secret || isGM ) return entry.token ? "token" : "none";
  if ( gmMode === "hidden" ) return "none";
  if ( gmMode === "token" ) return entry.token ? "token" : "banner";
  return "banner";
}

/**
 * The array of waits known to this client: those of a user replace the previous ones (`replace`), a wait arrives or
 * leaves (`add`, `remove`), a disconnected user loses all of theirs (`drop`). Returns a new array, sorted by age.
 * @param {object[]} entries
 * @param {{type: "add"|"remove"|"replace"|"drop", entry?: object, id?: string, userId?: string, list?: object[]}} change
 */
export function applyAwaiting(entries, change) {
  const list = [...entries];
  const sorted = l => l.sort((a, b) => (a.since - b.since) || a.id.localeCompare(b.id));
  switch ( change?.type ) {
    case "add": {
      const entry = awaitingEntry(change.entry);
      if ( !entry ) return sorted(list);
      return sorted([...list.filter(e => e.id !== entry.id), entry]);
    }
    case "remove": return sorted(list.filter(e => e.id !== change.id));
    case "drop": return sorted(list.filter(e => e.userId !== change.userId));
    case "replace": {
      const fresh = (change.list ?? []).map(awaitingEntry).filter(e => e && (e.userId === change.userId));
      return sorted([...list.filter(e => e.userId !== change.userId), ...fresh]);
    }
    default: return sorted(list);
  }
}

/** The waits still valid at `now`. */
export function pruneAwaiting(entries, now) {
  return entries.filter(e => awaitingAlive(e, now));
}
