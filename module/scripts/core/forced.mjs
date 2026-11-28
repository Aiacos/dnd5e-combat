/**
 * §408 (issue #44, batch 1): what a player overrode by confirming the legality window. Pure: no dependency on Foundry.
 */

/**
 * The reasons truly overridden. "Use my Reaction" outside one's turn (an Opportunity Attack) settles the budget problems:
 * that is not forcing. The other reasons (range, condition, sight…) stay overridden. Duplicates removed, order kept.
 * @param {object} choice
 * @param {string[]} choice.lines         All the reasons of the window.
 * @param {string[]} [choice.budgetLines] Those that come from the turn budget (turn, action spent…).
 * @param {string} choice.action          The button chosen: "go", "reaction", other (given up).
 * @returns {string[]}  empty when nothing was overridden.
 */
export function forcedReasons({ lines, budgetLines=[], action }) {
  if ( (action !== "go") && (action !== "reaction") ) return [];
  const skip = (action === "reaction") ? new Set(budgetLines) : new Set();
  return [...new Set((lines ?? []).filter(l => l && !skip.has(l)))];
}

/**
 * §411: does a refusal reason found at click time (aiming, menu) go along with the use (`issues`)? Not when the legality window or
 * `engage` find it themselves: range, other plane, Chain Lightning (designated targets), contact (`engage`). Line of sight goes
 * only when the gesture does not go through `engage` (`blind`: multiple aiming of a spell with targets).
 * @param {string} kind  `outOfRange`, `blind`, `plane`, `chain`, `contact` or `other`.
 * @param {{blind?: boolean}} [options]
 */
export function forwardsIssue(kind, { blind=false }={}) {
  if ( kind === "blind" ) return blind;
  return !["outOfRange", "plane", "chain", "contact"].includes(kind);
}

/** §411: the reasons of a use, gathered without duplicates (order kept, empties removed). */
export function mergeIssues(...lists) {
  return [...new Set(lists.flat().filter(l => (typeof l === "string") && l))];
}

/** §412: the key of a set of reasons (stable keys), with no order or duplicates — the memory of a forced refusal. */
export function forcedKey(keys) {
  return [...new Set((keys ?? []).filter(Boolean).map(String))].sort().join(",");
}

/** §417: what an engine refusal becomes. `level`: according to the automation level — today the window, at every level. */
export const REFUSAL_MODES = Object.freeze(["level", "window", "notice", "strict", "off"]);

/**
 * §417: the "Impossible action" setting translated into gestures. `window`: the window opens; `proceed`: true = the action
 * goes ahead without waiting, false = it cannot go ahead (window without "use anyway"), null = whoever acts decides; `warn`: a
 * notice on the screen of whoever acts; `report`: the GM and the table are warned, the card marked. The GM always keeps
 * control: on strict refusal, they get the whole window.
 * @param {string} mode
 * @param {{isGM?: boolean}} [who]
 */
export function refusalOutcome(mode, { isGM=false }={}) {
  const m = (!REFUSAL_MODES.includes(mode) || (mode === "level")) ? "window" : mode;
  if ( m === "off" ) return { mode: m, window: false, proceed: true, warn: false, report: false };
  if ( m === "notice" ) return { mode: m, window: false, proceed: true, warn: true, report: true };
  if ( (m === "strict") && !isGM ) return { mode: m, window: true, proceed: false, warn: false, report: false };
  return { mode: m, window: true, proceed: null, warn: false, report: true };
}

/**
 * §448: the key of a "do it anyway" question — its title (item — actor) and its reasons. Two requests with the same key open at
 * once on a workstation are a double click: the second is ignored (runtime/turn.mjs, `askAnyway`).
 * @param {string} title
 * @param {string[]} lines
 */
export function askKey(title, lines=[]) {
  return [String(title ?? ""), ...(lines ?? []).map(String)].join("\n");
}

/**
 * Issue #178: who sees that a rule was overridden (the "Forced" floating text, the card banner). World setting
 * `overrideVisibility`: `all` (the whole table, the default, as before), `hideGM` (the GM's stay discreet, the players'
 * are public), `gmOnly` (none is shown to players). The GM always sees everything, and whoever forced sees their own mark.
 */
export const OVERRIDE_VISIBILITY_MODES = Object.freeze(["all", "hideGM", "gmOnly"]);

/**
 * Issue #178: is the mark of an override public (seen by the whole table)?
 * @param {string} mode  `overrideVisibility`; an unknown value counts as `all`.
 * @param {{byGM?: boolean}} [who]  `byGM`: a GM forced it.
 */
export function overridePublic(mode, { byGM=false }={}) {
  if ( mode === "gmOnly" ) return false;
  if ( mode === "hideGM" ) return !byGM;
  return true;
}

/**
 * Issue #178: does this client show the mark? A GM and whoever forced, always; the others according to `overridePublic`.
 * @param {string} mode
 * @param {{byGM?: boolean, viewerIsGM?: boolean, viewerIsAuthor?: boolean}} [who]
 */
export function overrideShown(mode, { byGM=false, viewerIsGM=false, viewerIsAuthor=false }={}) {
  return viewerIsGM || viewerIsAuthor || overridePublic(mode, { byGM });
}
