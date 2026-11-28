/**
 * §244: the lock of a door (issue #22). What the GM sets in the wall configuration (section "DAS · Lock", flag
 * `flags.dnd5e-combat.lock`): a DC to pick, a DC to force (or "cannot be forced"), an optional key (item name or
 * identifier). An empty DC: the GM rules on the result, as before. The 2024 rules give no fixed DC; the
 * Dungeon Master's Guide benchmarks (Easy 10, Medium 15, Hard 20…) are suggested in the field.
 *
 * Pure: no dependency on Foundry.
 */

/** The ways of opening a lock. */
export const LOCK_METHODS = Object.freeze(["pick", "force", "key"]);

/** The DC benchmarks of the Dungeon Master's Guide, suggested in the wall configuration. */
export const LOCK_DC_PRESETS = Object.freeze([5, 10, 15, 20, 25, 30]);

/** World setting `lockFailure`: a failure costs nothing ("free") or only one attempt per character and per way ("once"). */
export const LOCK_FAILURE_MODES = Object.freeze(["free", "once"]);

const dcOf = value => {
  if ( (value === null) || (value === undefined) || (value === "") ) return null;
  const n = Number(value);
  return (Number.isFinite(n) && (n >= 1)) ? Math.round(n) : null;
};

/**
 * A wall's `lock` flag, read without trusting its shape.
 * @param {object} [flag]
 * @returns {{pickDc: number|null, forceDc: number|null, unforceable: boolean, key: string}}
 */
export function normalizeLock(flag) {
  const f = (flag && (typeof flag === "object")) ? flag : {};
  return {
    pickDc: dcOf(f.pickDc),
    forceDc: dcOf(f.forceDc),
    unforceable: f.unforceable === true,
    key: String(f.key ?? "").trim()
  };
}

const fold = s => String(s ?? "").trim().toLocaleLowerCase();

/**
 * Is this item the key? Same name (ignoring case and surrounding spaces), or same dnd5e identifier.
 * @param {{name?: string, identifier?: string}} item
 * @param {string} key
 */
export function isKey(item, key) {
  const wanted = fold(key);
  if ( !wanted || !item ) return false;
  return (fold(item.name) === wanted) || (fold(item.identifier) === wanted);
}

/**
 * The verdict of an attempt: "success", "failure", or "gm" when the door has no DC for this way (the GM rules).
 * @param {object} lock      normalizeLock
 * @param {"pick"|"force"} method
 * @param {number} total     The total of the check.
 */
export function judgeAttempt(lock, method, total) {
  if ( (method === "force") && lock.unforceable ) return "failure";
  const dc = (method === "pick") ? lock.pickDc : lock.forceDc;
  if ( dc === null ) return "gm";
  if ( !Number.isFinite(total) ) return "failure";
  return (total >= dc) ? "success" : "failure";
}

/**
 * The attempts already made on a lock (flag `lockTries`: { [character]: ["pick", "force"] }), read cleanly.
 * @param {object} [flag]
 * @returns {Record<string, string[]>}
 */
export function normalizeTries(flag) {
  const out = {};
  if ( !flag || (typeof flag !== "object") ) return out;
  for ( const [who, methods] of Object.entries(flag) ) {
    const list = [methods].flat().filter(m => (m === "pick") || (m === "force"));
    if ( list.length ) out[who] = [...new Set(list)];
  }
  return out;
}

/**
 * A character's key in the attempts flag: its uuid without dots (a Foundry update unfolds a dotted key into nested
 * objects: "Actor.abc" would become { Actor: { abc } }).
 */
export function triesKey(uuid) {
  return String(uuid ?? "").replaceAll(".", "_");
}

/** Has this character already tried this way, when the setting grants only one attempt? */
export function alreadyTried(tries, who, method, mode) {
  return (mode === "once") && (tries[who] ?? []).includes(method);
}

/** The attempts after a failure of `who` ("one attempt" setting); unchanged otherwise. */
export function recordTry(tries, who, method, mode) {
  if ( (mode !== "once") || !who ) return tries;
  const list = new Set(tries[who] ?? []);
  list.add(method);
  return { ...tries, [who]: [...list] };
}

/**
 * The lock entries that a character sees in front of a locked door, in menu order.
 * @param {object} lock                normalizeLock
 * @param {object} state
 * @param {boolean} state.hasKey       It carries the key.
 * @param {Record<string, string[]>} state.tries
 * @param {string} state.who           The character (its uuid).
 * @param {string} state.mode          Setting `lockFailure`.
 * @param {boolean} [state.hasTools]   O9d (§357): it carries thieves' tools — without them, picking is not offered.
 * @returns {Array<{method: string, spent: boolean}>}  `spent`: attempt already made (the entry says so, a click reminds).
 */
export function lockChoices(lock, { hasKey=false, tries={}, who="", mode="free", hasTools=true }={}) {
  const out = [];
  if ( lock.key && hasKey ) out.push({ method: "key", spent: false });
  if ( hasTools ) out.push({ method: "pick", spent: alreadyTried(tries, who, "pick", mode) });
  if ( !lock.unforceable ) out.push({ method: "force", spent: alreadyTried(tries, who, "force", mode) });
  return out;
}

/** The door state after a success: picked or opened with the key, it is closed; forced, it opens. */
/**
 * §247: the payload of the public hook `dnd5e-combat.lockAttempt` (without documents) — the way, the outcome (`success`, `failure`,
 * `gm`) and the check total (null for the key, or an unreadable total).
 */
export function attemptReport(method, outcome, total) {
  const value = Number(total);
  return { method, outcome, total: ((method !== "key") && (total !== null) && (total !== undefined) && Number.isFinite(value)) ? value : null };
}

export function stateAfter(method) {
  return (method === "force") ? "open" : "closed";
}
