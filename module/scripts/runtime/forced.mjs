/**
 * §408 (issue #44, batch 1): a rule overridden. User's rule (2026-11-11): every engine refusal opens a window that says
 * why, offers to do it anyway, and **the player** decides; if they force it, the GM and the table are **warned**, nothing more
 * (no agreement to ask for).
 *  - issue #178: world setting `overrideVisibility` (core/forced.mjs `overridePublic`) — when the override is not public, the
 *    floating text goes only to whoever forces and to the GMs, and the card's banner is shown only to them;
 *  - the GM: the §364 alert (card whispered to the GMs + banner), text `DND5ECOMBAT.Force.Alerte` — world setting `forcedAlerts`;
 *  - the table: a "Forced" floating text above the token, discreet, with no sound (`notice`, kind `forced`);
 *  - the card: the flag `flags.dnd5e-combat.overridden` (the reasons), set by the caller on the use or roll card and
 *    shown by ui/chat.mjs;
 *  - public hook `dnd5e-combat.forced` `({ actor, item, reasons, targets, user })`, called first: a neighbor that returns
 *    `false` takes the warning on itself (no alert, no floating text).
 * Called on the client of whoever forces, at the moment they choose.
 */

import { MODULE_ID } from "../constants.mjs";
import { alertGM, gmAlertsOn } from "./gm-alert.mjs";
import { REFUSAL_MODES, refusalOutcome, OVERRIDE_VISIBILITY_MODES, overridePublic, overrideShown } from "../core/forced.mjs";
import { log, loc, notice } from "./shared.mjs";

/**
 * §408: on the client of whoever overrides an engine refusal, before any warning: `({ actor, item, reasons, targets, user })`.
 * Cancellable: `false` and the engine warns nobody (no floating text, no alert to the GM).
 */
export const FORCED_HOOK = `${MODULE_ID}.forced`;
/** World setting: warn the GM when a player overrides (the table always sees the floating text). */
export const FORCED_ALERTS_SETTING = "forcedAlerts";

/** Issue #178: world setting "Overrides visible to" — the whole table, all but the GM's own, GM only. */
export const OVERRIDE_VISIBILITY_SETTING = "overrideVisibility";

function visibility() {
  try { return game.settings.get(MODULE_ID, OVERRIDE_VISIBILITY_SETTING) ?? "all"; } catch { return "all"; }
}

/**
 * Issue #178: does this client show the "Rule overridden" banner of this card? Who forced: the card's author (it is created
 * on the machine of whoever acts).
 * @param {ChatMessage} message
 */
export function overriddenShownOn(message) {
  return overrideShown(visibility(), { byGM: message?.author?.isGM === true, viewerIsGM: game.user?.isGM === true,
    viewerIsAuthor: !!message?.author && (message.author.id === game.user?.id) });
}

/** §417: world setting "Impossible action" — window, simple warning, strict refusal for players, no check. */
export const REFUSAL_SETTING = "refusalMode";

/** §417: what a refusal becomes for this client (core/forced.mjs, `refusalOutcome`). */
export function refusal() {
  let mode = "level";
  try { mode = game.settings.get(MODULE_ID, REFUSAL_SETTING); } catch { /* setting not yet declared */ }
  return refusalOutcome(mode, { isGM: game.user?.isGM === true });
}

function forcedAlertsOn() {
  try { return game.settings.get(MODULE_ID, FORCED_ALERTS_SETTING) !== false; } catch { return true; }
}

/** The token acting for this actor on the displayed scene (the card's, if we have it), or null. */
function tokenOf(actor, token=null) {
  if ( token ) return token.document ?? token;
  return actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
}

/**
 * Warns the GM and the table that a rule was overridden.
 * @param {object} forced
 * @param {Actor5e|null} forced.actor         Who acts.
 * @param {Item5e|string|null} [forced.item]  What is used (or its name).
 * @param {string[]} forced.reasons            The window's reasons, already translated.
 * @param {string[]} [forced.targets]          The names of the designated targets.
 * @param {TokenDocument|Token|null} [forced.token]
 * @returns {Promise<boolean>}  true if the warning went out.
 */
export async function reportForced({ actor, item=null, reasons, targets=[], token=null }) {
  if ( !reasons?.length || !refusal().report ) return false;   // §417: "no check" — nobody is warned
  const itemName = (typeof item === "string") ? item : (item?.name ?? "");
  if ( Hooks.call(FORCED_HOOK, { actor, item, reasons, targets, user: game.user }) === false ) return false;
  log(`rule overridden by ${game.user.name}: ${itemName || "?"} (${actor?.name ?? "?"}) — ${reasons.join(" | ")}`);
  const where = tokenOf(actor, token);
  // Issue #178: public, the whole table sees it; otherwise whoever forces and the GMs only. A discreet text, with no sound or flash
  // (user's request, 2026-11-21: the feedback on the token was too present).
  const open = overridePublic(visibility(), { byGM: game.user?.isGM === true });
  if ( where ) notice(where, { key: "Retour.Force" }, "forced", { all: true, gmOnly: !open, action: "overridden", outcome: "success", sound: null });
  if ( forcedAlertsOn() && gmAlertsOn() ) {
    // §412: a gesture with no object (a movement, a climb) — "… for {actor}: {reasons}", without an empty "—".
    const key = itemName ? (targets.length ? "Force.AlerteCibles" : "Force.Alerte") : "Force.AlerteSansObjet";
    const text = loc(key, {
      user: game.user.name, item: itemName, actor: actor?.name ?? "", targets: targets.join(", "), reasons: reasons.join(" · ") });
    await alertGM({ text, item: itemName || null, actor });
  }
  return true;
}

/** The reasons to carry on the card (flag `overridden`): a short list, as is. */
export function overriddenFlag(reasons) {
  return (reasons ?? []).map(r => String(r)).slice(0, 12);
}

export function registerForced() {
  game.settings.register(MODULE_ID, REFUSAL_SETTING, { scope: "world", config: true, type: String, default: "level",
    name: `DND5ECOMBAT.Reglage.${REFUSAL_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${REFUSAL_SETTING}.Aide`,
    choices: Object.fromEntries(REFUSAL_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${REFUSAL_SETTING}.${m}`])) });
  game.settings.register(MODULE_ID, OVERRIDE_VISIBILITY_SETTING, { scope: "world", config: true, type: String, default: "all",
    name: `DND5ECOMBAT.Reglage.${OVERRIDE_VISIBILITY_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${OVERRIDE_VISIBILITY_SETTING}.Aide`,
    choices: Object.fromEntries(OVERRIDE_VISIBILITY_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${OVERRIDE_VISIBILITY_SETTING}.${m}`])),
    onChange: () => ui.chat?.render?.() });
  game.settings.register(MODULE_ID, FORCED_ALERTS_SETTING, { scope: "world", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${FORCED_ALERTS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${FORCED_ALERTS_SETTING}.Aide` });
}
