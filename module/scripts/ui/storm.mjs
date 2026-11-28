/**
 * §70: the Call Lightning question at casting — "outdoors, in stormy weather?" (the ongoing storm comes under your
 * control, damage +1d10). Returns true, false, or null if the window is closed (nothing is cast).
 */

import { loc } from "../runtime/shared.mjs";

export async function askStorm(activity, bonus) {
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-cloud-bolt" },
    content: `<p>${loc("Orage.Question")}</p><p class="hint">${loc("Orage.Aide", { bonus })}</p>`,
    buttons: [
      { action: "no", label: loc("Orage.Non"), icon: "fa-solid fa-cloud", default: true, callback: () => "no" },
      { action: "yes", label: loc("Orage.Oui", { bonus }), icon: "fa-solid fa-cloud-bolt", callback: () => "yes" }
    ],
    rejectClose: false
  }).catch(() => null);
  return (answer === "yes") ? true : (answer === "no") ? false : null;
}
