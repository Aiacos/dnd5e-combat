/**
 * Choose by clicking among cards (a weapon, a form): the window closes on the clicked card. Refused cards
 * (`.refused`) stay visible, greyed out, with their reason as a tooltip. Shared by the Pact of the Blade (ui/pact.mjs) and the
 * choice of the weapon to enchant (ui/enchant.mjs).
 */

import { esc } from "../runtime/shared.mjs";

/** A weapon card: portrait and name; `refusal` greys it out, with its reason. */
export function weaponCard({ uuid, img, name, refusal=null }) {
  return `
    <div class="dnd5e-combat-form${refusal ? " refused" : ""}" data-uuid="${esc(uuid)}" title="${esc(refusal ?? name)}">
      <img src="${esc(img)}" alt=""><span class="name">${esc(name)}</span>
    </div>`;
}

/**
 * The choice window: `content` (the cards, in `.dnd5e-combat-forms`), a `label` / `buttonIcon` button that confirms. Returns the
 * `data-uuid` of the clicked card, or null (window closed).
 */
export async function pickCard({ title, icon, width, content, label, buttonIcon=icon }) {
  let picked = null;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title, icon },
    position: { width },
    content,
    buttons: [{ action: "pick", label, icon: buttonIcon, default: true, callback: () => ({ pick: picked }) }],
    render: (event, dialog) => {
      dialog.element.querySelectorAll(".dnd5e-combat-form:not(.refused)").forEach(card => card.addEventListener("click", () => {
        picked = card.dataset.uuid;
        dialog.element.querySelector('button[data-action="pick"]')?.click();
      }));
    },
    rejectClose: false
  }).catch(() => null);
  return ((answer && (typeof answer === "object")) ? answer.pick : null) ?? null;
}
