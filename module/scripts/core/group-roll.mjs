/**
 * §242 (issue #18): rolls requested by the GM from several characters — ability check, saving throw, skill or tool check,
 * with a DC (shown or hidden from players), Advantage or Disadvantage, a fixed modifier and a label ("Jump the bridge").
 * Here, the rule alone: the valid request, each result, the verdict of the group check (PHB 2024: the group succeeds if at
 * least half of its members succeed) and what a player is allowed to see.
 *
 * Pure: no dependency on Foundry.
 */

export const ROLL_TYPES = Object.freeze(["check", "save", "skill", "tool", "initiative"]);

/** §397: the key of an Initiative request (the sheet's Initiative roll, its ability included). */
export const INITIATIVE_KEY = "init";

/**
 * The request, normalized; an error (English text, for the console) if it cannot be played.
 * @param {object} input
 * @param {string} input.type          "check" | "save" | "skill" | "tool"
 * @param {string} input.key           The ability (check, save), the skill or the tool.
 * @param {number|string|null} [input.dc]
 * @param {boolean} [input.hideDc]     The DC is not shown to players.
 * @param {boolean} [input.advantage]
 * @param {boolean} [input.disadvantage]
 * @param {number|string} [input.bonus]  Fixed modifier (integer, positive or negative).
 * @param {string} [input.label]
 * @param {boolean} [input.group]      Group check (2024).
 * @param {string|null} [input.ability] For a skill or a tool: an ability other than the default one.
 * @param {string|null} [input.combat] §397: for Initiative, the combat whose combatants receive the result.
 * @returns {{request: object|null, error: string|null}}
 */
export function normalizeRequest(input={}) {
  const type = String(input.type ?? "");
  if ( !ROLL_TYPES.includes(type) ) return { request: null, error: `unknown roll type "${type}"` };
  const initiative = type === "initiative";
  const key = initiative ? INITIATIVE_KEY : String(input.key ?? "").trim();
  if ( !key ) return { request: null, error: "no ability, skill or tool given" };
  const dcNumber = Number(input.dc);
  const dc = ((input.dc === null) || (input.dc === undefined) || (input.dc === "") || !Number.isFinite(dcNumber)) ? null
    : Math.max(0, Math.round(dcNumber));
  const bonusNumber = Number(input.bonus);
  const bonus = Number.isFinite(bonusNumber) ? Math.round(bonusNumber) : 0;
  let advantage = !!input.advantage;
  let disadvantage = !!input.disadvantage;
  if ( advantage && disadvantage ) advantage = disadvantage = false;   // les deux s'annulent (PHB 2024)
  const ability = ((type === "skill") || (type === "tool")) && input.ability ? String(input.ability) : null;
  return {
    request: {
      type, key, ability, dc, hideDc: (dc !== null) && !!input.hideDc, advantage, disadvantage, bonus,
      label: String(input.label ?? "").trim().slice(0, 120), group: !initiative && !!input.group,
      ...(initiative ? { combat: input.combat ? String(input.combat) : null } : {})
    },
    error: null
  };
}

/** Success of a total against a DC: true, false, or null with no DC or total. */
export function outcomeOf(total, dc) {
  if ( (dc === null) || (dc === undefined) || !Number.isFinite(Number(total)) ) return null;
  return Number(total) >= Number(dc);
}

/**
 * The status of the request: each one (`waiting` or `rolled`, total, success), the count, and the verdict of the group.
 * @param {{dc: number|null, group: boolean}} request
 * @param {Array<{total: number|null}>} entries  `total` null: not rolled yet.
 * @returns {{entries: Array<object>, rolled: number, waiting: number, successes: number, failures: number, done: boolean,
 *   success: boolean|null}}  `success`: the verdict — of the group (group check), otherwise of everyone (each one succeeds);
 *   null with no DC or as long as the result is not settled.
 */
export function tally(request, entries) {
  const dc = request?.dc ?? null;
  const out = entries.map(e => {
    const rolled = Number.isFinite(e.total) && (e.total !== null);
    // Issue #32: a line accepted as a success at a cost (`atCost`) counts as succeeded, its total remaining that of the roll.
    return { ...e, status: rolled ? "rolled" : "waiting", success: rolled ? ((e.atCost && (dc !== null)) ? true : outcomeOf(e.total, dc)) : null };
  });
  const rolled = out.filter(e => e.status === "rolled").length;
  const waiting = out.length - rolled;
  const successes = out.filter(e => e.success === true).length;
  const failures = out.filter(e => e.success === false).length;
  const done = (out.length > 0) && (waiting === 0);
  let success = null;
  if ( (dc !== null) && out.length ) {
    if ( request.group ) {
      // "If at least half the group succeeds, the group succeeds" — settled as soon as half have succeeded, or lost as soon as
      // too many have failed to reach it.
      const needed = Math.ceil(out.length / 2);
      if ( successes >= needed ) success = true;
      else if ( (out.length - failures) < needed ) success = false;
    }
    else if ( failures > 0 ) success = false;
    else if ( done ) success = true;
  }
  return { entries: out, rolled, waiting, successes, failures, done, success };
}

/**
 * What a client is allowed to see: the GM everything; a player, without the hidden DC, and no successes or verdict while hidden.
 * @param {object} view     `tally()` completed with the request (`request`).
 * @param {{gm: boolean}} viewer
 */
export function visibleTo(view, { gm }) {
  if ( gm || !view?.request?.hideDc ) return view;
  return {
    ...view,
    request: { ...view.request, dc: null },
    entries: view.entries.map(e => ({ ...e, success: null })),
    successes: null, failures: null, success: null
  };
}
