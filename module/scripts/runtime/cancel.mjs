/**
 * Cancel the action in progress as long as no die is rolled (SPEC §15.1, "right click cancels"):
 * the use is erased as if it had not happened. After that, it is the GM's "Cancel".
 *
 * On the author's client: the roll dialog still open (attack or damage, nothing rolled)
 * is closed, dnd5e gives back what it had consumed (`Activity#refund` on the message's `system.deltas`,
 * documents/activity/mixin.mjs:385 — the card's "Refund" button does the same,
 * mixin.mjs:1100), the Concentration opened by this spell ends, then the card is deleted,
 * marked `cancelled`. The active GM then gives back the budget spend (runtime/turn.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { concentrationEffectOf } from "../adapter/concentration.mjs";
import { log, loc } from "./shared.mjs";

/** Beyond that, a card is no longer "the action in progress". */
const PENDING_MS = 300000;

/** No die yet rolled for this use (attack, damage, save)? */
function noDiceYet(message) {
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !resolution ) return true;
  return !resolution.attack && !resolution.damageRoll && !resolution.targets?.some(t => t.save && (t.save.total !== null));
}

/** The latest use card of this activity, from this client, recent and with no die. */
function pendingUsageOf(activity) {
  const recent = game.messages.contents.slice(-30).reverse();
  return recent.find(m => m.isAuthor && (m.type === "usage") && (m.getAssociatedActivity?.()?.uuid === activity.uuid)
    && ((Date.now() - (m.timestamp ?? 0)) < PENDING_MS) && noDiceYet(m)) ?? null;
}

/** Erases a use: resources returned, Concentration removed, card deleted (the GM gives back the budget). */
export async function cancelUsage(message) {
  const activity = message.getAssociatedActivity?.();
  if ( activity && message.system?.deltas ) await activity.refund(message.system.deltas);
  const effect = concentrationEffectOf(message);
  if ( effect ) await effect.parent?.endConcentration?.(effect);
  await message.setFlag(MODULE_ID, "cancelled", true);
  await message.delete();
  log(`action cancelled before any roll: ${activity?.item?.name ?? message.id}`);
  ui.notifications.info(loc("Annulation.Faite", { name: activity?.item?.name ?? "" }));
}

/**
 * The open roll dialog of an action of this client whose card has no die yet, with this
 * card; null otherwise (a damage dialog after a hit can no longer be canceled: it is the
 * GM's "Cancel"). Synchronous: read on click.
 * @returns {{app: object, message: ChatMessage}|null}
 */
export function pendingRoll() {
  const Dialog = globalThis.dnd5e?.applications?.dice?.RollConfigurationDialog;
  if ( !Dialog ) return null;
  for ( const app of foundry.applications.instances.values() ) {
    if ( !(app instanceof Dialog) || !app.rendered ) continue;
    const activity = app.config?.subject;
    if ( !activity?.uuid || !activity.item ) continue;   // an ability check, not an action
    if ( app.config?.[MODULE_ID]?.dialog ) continue;   // §556: damage the engine rolls after a hit or a save, not cancellable
    const message = pendingUsageOf(activity);
    if ( message ) return { app, message };
  }
  return null;
}

/** Closes the roll dialog of an action with no die and erases its use. true if something was canceled. */
export async function cancelPendingRoll() {
  const pending = pendingRoll();
  if ( !pending ) return false;
  await pending.app.close();
  await cancelUsage(pending.message);
  return true;
}
