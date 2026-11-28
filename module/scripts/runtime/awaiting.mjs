/**
 * §381 (issue #35): whom the table is waiting for — the settings, the request that carries the waits from one client to
 * another, and what makes them drop with no answer: the disconnection of whoever answers (core hook `userConnected`,
 * client/documents/collections/users.mjs:137) and forgetting a wait with no news. An arriving client asks for the waits in
 * progress (`ready`).
 */

import { MODULE_ID } from "../constants.mjs";
import { AWAITING_GM_MODES, AWAITING_REFRESH_MS } from "../core/awaiting.mjs";
import { AWAITING_QUERY, changeAwaiting, pruneKnown, receiveAwaiting, refreshAwaiting, syncAwaiting } from "../adapter/awaiting.mjs";
import { route } from "./router.mjs";

export const AWAITING_SETTINGS = Object.freeze({ show: "awaitingShow", gm: "awaitingGm", hide: "awaitingHide" });
/** A display setting changed, on this client (the drawing is redone). */
export const AWAITING_SETTINGS_HOOK = `${MODULE_ID}.awaitingSettings`;

let heartbeat = null;

export function registerAwaiting() {
  const S = AWAITING_SETTINGS;
  const key = k => `DND5ECOMBAT.Reglage.${k}`;
  const onChange = () => Hooks.callAll(AWAITING_SETTINGS_HOOK);
  game.settings.register(MODULE_ID, S.show, { scope: "world", config: true, type: Boolean, default: true,
    name: `${key(S.show)}.Nom`, hint: `${key(S.show)}.Aide`, onChange });
  game.settings.register(MODULE_ID, S.gm, { scope: "world", config: true, type: String, default: "discreet",
    choices: Object.fromEntries(AWAITING_GM_MODES.map(m => [m, `${key(S.gm)}.Choix.${m}`])),
    name: `${key(S.gm)}.Nom`, hint: `${key(S.gm)}.Aide`, onChange });
  game.settings.register(MODULE_ID, S.hide, { scope: "client", config: true, type: Boolean, default: false,
    name: `${key(S.hide)}.Nom`, hint: `${key(S.hide)}.Aide`, onChange });
  CONFIG.queries[AWAITING_QUERY] = receiveAwaiting;

  route("ready", () => {
    syncAwaiting();
    clearInterval(heartbeat);
    // Refresh one's own waits (the others do not forget them) and forget those of the others left with no news.
    heartbeat = setInterval(() => {
      refreshAwaiting();
      pruneKnown();
    }, AWAITING_REFRESH_MS);
  }, { label: "awaiting: not synchronised", always: true });
  route("userConnected", (user, connected) => {
    if ( !connected ) changeAwaiting({ type: "drop", userId: user.id });
  }, { label: "awaiting: a disconnected user's prompts not cleared", always: true });
}

/** The settings that decide what this client shows (read by ui/awaiting.mjs and `api.ui.awaiting`). */
export function awaitingViewer() {
  const get = (k, fallback) => { try { return game.settings.get(MODULE_ID, k); } catch { return fallback; } };
  return {
    userId: game.user?.id ?? null, isGM: game.user?.isGM === true,
    enabled: get(AWAITING_SETTINGS.show, true) !== false,
    hidden: get(AWAITING_SETTINGS.hide, false) === true,
    gmMode: get(AWAITING_SETTINGS.gm, "discreet")
  };
}
