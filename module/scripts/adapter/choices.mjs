/**
 * The "which effect?" question asked to the author of an action with exclusive effects (SPEC §7, stage
 * `choice`; Hex). Same circuit as reactions (adapter/reactions.mjs): the Foundry core's
 * `user.query` request goes to the connected player who owns the actor, failing that the active GM
 * answers themselves. An answer is REQUIRED: with no answer from the player, the GM is consulted in turn.
 */

import { MODULE_ID } from "../constants.mjs";
import { needsCheck } from "../core/requests.mjs";
import { timedWait, inLine } from "./dialogs.mjs";
import { whileAwaiting } from "./awaiting.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { rollerFor } from "./concentration.mjs";

export const CHOICE_QUERY = `${MODULE_ID}.choice`;

/** Time left to the player; beyond it, the GM chooses. */
const CHOICE_TIMEOUT = 20000;   // beyond the window's timeout (adapter/dialogs.mjs)

/** §137: a question with no timeout (a choice made once, when a feat is gained) — the request waits for the player until then. */
const UNTIMED_TIMEOUT = 600000;

/** Beyond this number of options, a dropdown list rather than one button per option. */
const LIST_ABOVE = 6;

/**
 * On the side of whoever chooses: a window, one button per option.
 * @param {{actor: string, item: string, prompt: string|null, options: Array<{id: string, label: string, icon?: string,
 *   class?: string, tooltip?: string, caption?: string}>, untimed?: boolean, seconds?: number}} payload
 *   `untimed` (§137): no timeout or countdown; closed without choosing, nothing is chosen. `seconds` (§242): its own timeout
 *   instead of that of combat windows (a check asked outside combat gives the player time to read). `front` (§282): the window
 *   goes in front of the others (Heroic Inspiration, placed before the other questions, based on the roll).
 *   `heading` (safe HTML), `icon` (title icon), `classes`: the dressing of a question that must stand out at a glance (§282).
 * @returns {Promise<{id: string}|null>}  null if the window is closed without choosing.
 */
export async function handleChoiceQuery({ actor: actorUuid, item, prompt, options, untimed=false, seconds=null, front=false, heading=null, icon=null, classes=[] }, { user=null }={}) {
  // §472: from a player, no header or dressing (reserved for engine questions asked by the GM); Foundry sanitizes the window.
  if ( needsCheck(user) ) {
    heading = null;
    classes = [];
    if ( !Array.isArray(options) ) options = [];
  }
  const actor = await fromUuid(actorUuid);
  const question = `${heading ?? ""}<p>${prompt ?? game.i18n.localize("DND5ECOMBAT.ChoixEffet")}</p>`;
  // §113: beyond a few options (Assistance: 18 skills), a dropdown list — one button per option made a
  // window taller than the screen.
  const many = options.length > LIST_ABOVE;
  const buttons = many
    ? [{ action: "list", label: game.i18n.localize("DND5ECOMBAT.ChoixValider"), icon: "fa-solid fa-check", default: true,
      callback: (event, button) => `pick${button.form?.elements?.pick?.value ?? 0}` }]
    : options.map((o, i) => ({ action: `pick${i}`, label: o.label, icon: o.icon ?? "fa-solid fa-hand-pointer", default: i === 0,
      // §282: the dressing of an option (a die to reroll) — class, tooltip, and a caption under the label (CSS variable, the core
      // writes the label as text only).
      ...(o.class ? { class: o.class } : {}), ...(o.tooltip ? { tooltip: o.tooltip } : {}),
      ...(o.caption ? { style: { "--caption": JSON.stringify(String(o.caption)) } } : {}) }));
  const list = many ? `<select name="pick" class="dnd5e-combat-choice-list" autofocus>${options
    .map((o, i) => ({ i, label: o.label })).sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
    .map(o => `<option value="${o.i}">${foundry.utils.escapeHTML(String(o.label))}</option>`).join("")}</select>` : "";
  const config = {
    window: { title: game.i18n.format("DND5ECOMBAT.ChoixTitre", { item, name: actor?.name ?? "" }), ...(icon ? { icon } : {}) },
    classes: [...classes],
    content: `${question}${list}`,
    buttons
  };
  // With no answer within the timeout: the first option. §137: without timeout, the window waits.
  // §381: the table sees that this choice is awaited (hourglass above the token), never what it is.
  const picked = untimed ? await inLine(() => whileAwaiting(actor, "choice", () => foundry.applications.api.DialogV2.wait({ ...config, rejectClose: false })))
    : await timedWait(config, { fallback: "pick0", front, awaiting: { actor, kind: "choice" }, ...(Number(seconds) > 0 ? { seconds: Number(seconds) } : {}) });
  const option = options[Number(String(picked ?? "").replace("pick", ""))];
  return picked?.startsWith?.("pick") && option ? { id: option.id } : null;
}

/**
 * On the active GM: asks the author, then the GM if the author does not answer. On the author's own client (§90: a check
 * they just rolled), the question is asked here.
 * @param {Actor} actor
 * @param {object} payload  See handleChoiceQuery.
 * @returns {Promise<{id: string}|null>}
 */
export async function askChoice(actor, payload) {
  const userId = rollerFor(actor);
  let answer = null;
  if ( userId === game.user.id ) return handleChoiceQuery(payload);
  if ( userId ) {
    const timeout = payload.untimed ? UNTIMED_TIMEOUT : (Number(payload.seconds) > 0 ? (Number(payload.seconds) + 15) * 1000 : CHOICE_TIMEOUT);
    try { answer = await queryPlayer(game.users.get(userId), CHOICE_QUERY, payload, { timeout, actor, label: waitLabel("Choix", { item: payload.item ?? "" }) }); }
    catch(err) { console.warn(`${MODULE_ID} | choice for ${actor.name}: no answer from the player`, err); }
    // §137: a question with no timeout stays with the player — closed without choosing, the GM is not consulted in their place.
    if ( payload.untimed ) return answer;
  }
  return answer ?? handleChoiceQuery(payload);
}
