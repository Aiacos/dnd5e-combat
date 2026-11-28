/**
 * §16.46: Arcane Vigor — after casting, how many Hit Dice to spend (from 1 up to the maximum allowed by the spell slot
 * level and by those remaining). The interface asks; runtime/defenses.mjs heals.
 */

import { hitDiceHealOf, hitDiceChoice } from "../adapter/defenses.mjs";
import { healWithHitDice } from "../runtime/defenses.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

async function onPostUse(activity, usageConfig, results) {
  if ( !hitDiceHealOf(activity) || !activity.actor?.isOwner ) return;
  const level = (Number(activity.item.system.level) || 0) + (Number(results?.message?.system?.scaling ?? usageConfig?.scaling) || 0);
  const { die, available, max } = hitDiceChoice(activity, level);
  if ( !max ) return ui.notifications.warn(loc("Vigueur.Aucun", { item: activity.item.name }));
  const buttons = Array.from({ length: max }, (_, i) => ({ action: String(i + 1), label: `${i + 1}${die}`, default: i === (max - 1) }));
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-heart-pulse" },
    content: `<p>${loc("Vigueur.Combien", { die, available, max })}</p>`,
    buttons, rejectClose: false
  }).catch(() => null);
  const count = Number(answer);
  if ( count > 0 ) await healWithHitDice(activity, die, count);
}

export function registerVigor() {
  route("dnd5e.postUseActivity", onPostUse, { label: "Arcane Vigor: Hit Point Dice not spent" });
}
