/**
 * Issue #32: "Success at a Cost" (2024 Dungeon Master's Guide, chapter 2), what touches Foundry and the windows — the GM's
 * window that describes the price, the question to the player who accepts or refuses.
 *
 * The price is the GM's text: nothing is applied automatically. The window's suggestions only fill in the field.
 */

import { MODULE_ID } from "../constants.mjs";
import { handleChoiceQuery } from "./choices.mjs";
import { rollerFor } from "./concentration.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";

export const AT_COST_QUERY = `${MODULE_ID}.successAtCost`;

/** The time left to the player to answer (seconds); beyond it, it is a refusal. */
export const AT_COST_ANSWER_SECONDS = 30;

/** The price suggestions of the GM's window (keys `DND5ECOMBAT.APrix.Idee.<id>`). */
const IDEAS = Object.freeze(["prone", "drop", "alert", "advantage", "noise"]);

const t = (key, data) => (data ? game.i18n.format(`DND5ECOMBAT.APrix.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.APrix.${key}`));
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * On the GM's side: the window that describes the price. Returns `{ cost }` (text, possibly empty) to offer it, or null to
 * leave the failure. Without a timeout: the resolution waits for the GM, who has already chosen to deal with it.
 * @param {{name: string, what: string, total: number, needed: number, by: number}} candidate
 */
export async function askCost({ name, what, total, needed, by }) {
  const ideas = IDEAS.map(id => `<button type="button" class="das-at-cost__idea" data-idea="${id}">${esc(t(`Idee.${id}`))}</button>`).join("");
  const content = `<p class="das-at-cost__rule">${esc(t("Regle"))}</p>`
    + `<p>${esc(t("QuestionMJ", { name, what, total, needed, by }))}</p>`
    + `<label class="das-at-cost__label">${esc(t("Prix"))}`
    + `<input type="text" name="cost" maxlength="300" autofocus placeholder="${esc(t("PrixAide"))}"></label>`
    + `<div class="das-at-cost__ideas">${ideas}</div>`;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t("TitreMJ", { name }), icon: "fa-solid fa-scale-balanced" },
    classes: ["das-at-cost"],
    content,
    buttons: [
      { action: "offer", label: t("Proposer"), icon: "fa-solid fa-scale-balanced", default: true,
        callback: (event, button) => ({ cost: button.form?.elements?.cost?.value ?? "" }) },
      { action: "keep", label: t("LaisserEchec"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false,
    // A suggestion fills in the field (the GM can rework it in their own way).
    render: (event, dialog) => {
      const input = dialog.element?.querySelector?.("input[name=cost]");
      for ( const b of dialog.element?.querySelectorAll?.(".das-at-cost__idea") ?? [] ) {
        b.addEventListener("click", () => { if ( input ) { input.value = t(`Idee.${b.dataset.idea}`); input.focus(); } });
      }
    }
  });
  return (result && (typeof result === "object")) ? result : null;
}

/** On the player's side: the question, in the foreground. Returns `{ id: "yes" | "no" }`, or null (closed, timeout). */
export function handleAtCostQuery({ actor, name, what, cost }) {
  const heading = `<p class="das-at-cost__rule">${esc(t("Regle"))}</p>`;
  return handleChoiceQuery({
    actor, item: t("Nom"), front: true, heading, icon: "fa-solid fa-scale-balanced", classes: ["das-at-cost"],
    seconds: AT_COST_ANSWER_SECONDS,
    // The price on its own line: the GM's text keeps its punctuation.
    prompt: cost ? `${esc(t("QuestionJoueur", { name, what }))}<span class="das-at-cost__cost">${esc(cost)}</span>`
      : esc(t("QuestionJoueurSansPrix", { name, what })),
    // "Refuse" first: without an answer within the timeout, the window picks the first option — the failure stays.
    options: [{ id: "no", label: t("Refuser"), icon: "fa-solid fa-xmark" }, { id: "yes", label: t("Accepter"), icon: "fa-solid fa-check" }]
  });
}

/**
 * On the active GM: the question to the connected player who owns the actor. Without a connected player (NPC, absent
 * player), it is the GM who has already decided by offering: accepted. Returns true (accepted) or false.
 * @param {Actor} actor
 * @param {{name: string, what: string, cost: string|null}} payload
 */
export async function askPlayerAtCost(actor, payload) {
  const userId = rollerFor(actor);
  if ( !userId || (userId === game.user.id) ) return { accepted: true, by: "gm" };
  try {
    const answer = await queryPlayer(game.users.get(userId), AT_COST_QUERY, { actor: actor.uuid, ...payload },
      { timeout: (AT_COST_ANSWER_SECONDS + 15) * 1000, actor, label: waitLabel("APrix") });
    return { accepted: answer?.id === "yes", by: "player" };
  } catch(err) {
    console.warn(`${MODULE_ID} | success at a cost for ${actor.name}: no answer from the player`, err);
    return { accepted: false, by: "player" };
  }
}
