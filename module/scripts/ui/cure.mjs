/**
 * §16.47: Lesser Restoration (`cures`) — after the use, the condition to end on the target: automatically if there is only
 * one, otherwise by choice. The interface asks; runtime/cure.mjs removes.
 */

import { curable } from "../core/conditions.mjs";
import { contentOf } from "../adapter/content.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { cureStatus } from "../runtime/cure.mjs";
import { route } from "../runtime/router.mjs";
import { loc, notice } from "../runtime/shared.mjs";

async function onPostUse(activity, usageConfig, results) {
  const entry = contentOf(activity?.item).entry;
  const cures = entry?.cures;
  if ( !cures?.length || !activity.actor?.isOwner ) return;
  // §288: Break Enchantment — only this activity of the spell (not "Cast" nor "Return").
  if ( entry.curesOn && (entry.curesOn !== activity.id) ) return;
  const target = Array.from(game.user.targets)[0]?.document ?? usageTokenOf(activity);
  if ( !target?.actor ) return;
  const present = curable(Array.from(target.actor.statuses ?? []), cures);
  const label = s => game.i18n.localize(CONFIG.DND5E.conditionTypes[s]?.name ?? s);
  if ( !present.length ) return notice(target, loc("Guerison.Aucun", { name: target.name }));
  let status = present[0];
  if ( present.length > 1 ) {
    status = await foundry.applications.api.DialogV2.wait({
      window: { title: activity.item.name, icon: "fa-solid fa-hand-holding-medical" },
      content: `<p>${loc("Guerison.Choisir", { name: target.name })}</p>`,
      buttons: present.map((s, i) => ({ action: s, label: label(s), default: i === 0 })),
      rejectClose: false
    }).catch(() => null);
  }
  // The use card: the proof the GM reads when the target belongs to someone else (runtime/cure.mjs, §471).
  if ( status ) await cureStatus(target, status, { usage: results?.message?.id ?? null });
}

export function registerCureUi() {
  route("dnd5e.postUseActivity", onPostUse, { label: "restoration: condition not removed" });
}
