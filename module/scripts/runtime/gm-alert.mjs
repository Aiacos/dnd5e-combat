/**
 * §364: GM alert — what a feature or an effect leaves to the GM is flagged to them, at the moment it happens: a chat card whispered
 * to the GMs, in DAS colors (ui/gm-alert.mjs also shows it as a banner at the top of the GM's screen).
 *  - content `gmAlert: { key | text, activities? }` (or a list): on use of the item (all its activities, or those), the
 *    text `DND5ECOMBAT.AlerteMJ.<key>` (or `text`, for a world override or a neighboring module);
 *  - `alertGM({ text, item, actor })` for the rest of the engine (a wrath mark placed…), also published as `api.gm.alert`;
 *  - public hook `dnd5e-combat.gmAlert` `({ text, item, actor })`, called before the card: a neighbor that returns `false`
 *    replaces it.
 * The text receives `{actor}` (the user's name) and `{item}`. Active GM. World setting `gmAlerts` (§365): off, nothing is posted.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { esc, log, loc, viaActiveGM } from "./shared.mjs";

/**
 * §364: on the active GM, before posting a GM alert (and only if the `gmAlerts` setting is on): `({ text, item, actor })` —
 * `item` the item's name, `actor` the actor or null. Cancelable: `false` and neither card nor banner.
 */
export const GM_ALERT_HOOK = `${MODULE_ID}.gmAlert`;
/** §365: world setting — without it, no alert (neither card nor banner). */
export const GM_ALERTS_SETTING = "gmAlerts";

export function gmAlertsOn() {
  try { return game.settings.get(MODULE_ID, GM_ALERTS_SETTING) !== false; } catch { return true; }
}
const GM_ALERT_QUERY = `${MODULE_ID}.gmAlert`;

/** The text of a `gmAlert` rule, its variables filled in. */
function textOf(rule, { actor, item }) {
  const data = { actor: actor?.name ?? "", item: item?.name ?? "" };
  if ( rule.text ) return String(rule.text).replace(/\{(actor|item)\}/g, (m, k) => data[k]);
  return loc(`AlerteMJ.${rule.key}`, data);
}

/** On the active GM: the card whispered to the GMs. */
async function postAlert({ text, item=null, actor=null }) {
  if ( !gmAlertsOn() ) return null;
  const actorDoc = actor ? await fromUuid(actor) : null;
  const itemName = item ?? "";
  if ( Hooks.call(GM_ALERT_HOOK, { text, item: itemName, actor: actorDoc }) === false ) return null;
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const message = await ChatMessage.implementation.create({
    whisper: gms,
    speaker: actorDoc ? ChatMessage.implementation.getSpeaker({ actor: actorDoc }) : { alias: "DAS" },
    content: `<div class="das-gm-alert"><header><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(loc("AlerteMJ.Titre"))}</span></header>`
      + (itemName ? `<p class="das-gm-alert__item">${esc(itemName)}${actorDoc ? ` · ${esc(actorDoc.name)}` : ""}</p>` : "")
      + `<p class="das-gm-alert__text">${esc(text)}</p></div>`,
    flags: { [MODULE_ID]: { gmAlert: { text, item: itemName, actor: actorDoc?.name ?? null } } }
  });
  log(`GM alert: ${itemName ? `${itemName} — ` : ""}${text}`);
  return message?.id ?? null;
}

/**
 * Flags to the GM what falls to them. From any client: the card is created by the active GM.
 * @param {{ text: string, item?: Item|string|null, actor?: Actor|null }} alert
 */
export async function alertGM({ text, item=null, actor=null }) {
  if ( !text || !gmAlertsOn() ) return null;
  const payload = { text: String(text), item: (typeof item === "string") ? item : (item?.name ?? null), actor: actor?.uuid ?? null };
  if ( !game.users.activeGM ) return null;
  return viaActiveGM(GM_ALERT_QUERY, postAlert, payload);
}

/** The item's `gmAlert` rules that apply to this activity. */
export function alertsFor(item, activityId) {
  const rule = item ? contentOf(item).entry?.gmAlert : null;
  return [rule].flat().filter(Boolean).filter(r => !r.activities || r.activities.includes(activityId));
}

async function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const activity = message.getAssociatedActivity?.();
  const item = activity?.item ?? message.getAssociatedItem?.();
  const rules = alertsFor(item, activity?.id);
  if ( !rules.length || !gmAlertsOn() ) return;
  const actor = message.getAssociatedActor?.() ?? item?.actor ?? null;
  for ( const rule of rules ) await postAlert({ text: textOf(rule, { actor, item }), item: item?.name ?? null, actor: actor?.uuid ?? null });
}

export function registerGmAlert() {
  game.settings.register(MODULE_ID, GM_ALERTS_SETTING, { scope: "world", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${GM_ALERTS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${GM_ALERTS_SETTING}.Aide` });
  CONFIG.queries[GM_ALERT_QUERY] = postAlert;
  route("createChatMessage", onUsage, { executor: true, label: "GM alert: not posted" });
}
