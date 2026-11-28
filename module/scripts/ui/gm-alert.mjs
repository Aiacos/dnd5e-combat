/**
 * §364: GM alert, screen side — each alert card (runtime/gm-alert.mjs) is also displayed on each GM in a banner at the top of
 * the screen, in DAS colors: the item's name and what remains to handle. Several alerts stack; a click closes one;
 * they leave on their own after `gmAlertSeconds` (0: on click only). This workstation's settings: `gmAlertBanner`,
 * `gmAlertSeconds`.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { esc, loc } from "../runtime/shared.mjs";

export const GM_ALERT_BANNER_SETTING = "gmAlertBanner";
export const GM_ALERT_SECONDS_SETTING = "gmAlertSeconds";

let stack = null;

function container() {
  if ( stack?.isConnected ) return stack;
  stack = document.createElement("div");
  stack.className = "das-gm-alerts";
  stack.setAttribute("role", "alert");
  document.body.append(stack);
  return stack;
}

/** Shows an alert in the banner; returns the element. */
export function showGmAlert({ text, item=null, actor=null }) {
  const line = document.createElement("div");
  line.className = "das-gm-alerts__line";
  line.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>`
    + `<span class="das-gm-alerts__body"><span class="das-gm-alerts__title">${esc(loc("AlerteMJ.Titre"))}${item ? ` · ${esc(item)}` : ""}${actor ? ` (${esc(actor)})` : ""}</span>`
    + `<span class="das-gm-alerts__text">${esc(text)}</span></span><i class="fa-solid fa-xmark das-gm-alerts__close"></i>`;
  line.dataset.tooltip = loc("AlerteMJ.Fermer");
  const close = () => { line.classList.add("closing"); setTimeout(() => line.remove(), 250); };
  line.addEventListener("click", close);
  container().append(line);
  const seconds = Number(game.settings.get(MODULE_ID, GM_ALERT_SECONDS_SETTING)) || 0;
  if ( seconds > 0 ) setTimeout(close, seconds * 1000);
  return line;
}

function onMessage(message) {
  const alert = message.getFlag?.(MODULE_ID, "gmAlert");
  if ( !alert || !game.user.isGM || !game.settings.get(MODULE_ID, GM_ALERT_BANNER_SETTING) ) return;
  showGmAlert(alert);
}

export function registerGmAlertUi() {
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  client(GM_ALERT_BANNER_SETTING, { type: Boolean, default: true });
  client(GM_ALERT_SECONDS_SETTING, { type: Number, default: 15, range: { min: 0, max: 120, step: 5 } });
  route("createChatMessage", onMessage, { label: "GM alert: banner not shown" });
}
