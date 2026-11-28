/**
 * §50: the healer's kit (`stabilizes`) — one use, at the cost of a Utilize action, stabilizes an Unconscious creature at
 * 0 HP without a Medicine check. After the use (the spend and the action, dnd5e and
 * the engine's legality), the target aimed at is stabilized: by the active GM when it does not belong to the author.
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor } from "../core/requests.mjs";
import { contentOf } from "../adapter/content.mjs";
import { stabilize } from "../adapter/death.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaOwnerOrGM } from "./shared.mjs";

export const STABILIZE_QUERY = `${MODULE_ID}.stabilize`;

/** Active GM (or owner): the rule is read again — a client does not stabilize just anyone with just anything. */
async function handleStabilize({ target, activity: activityUuid }, { user=null }={}) {
  const token = await fromUuid(target ?? "");
  const activity = await fromUuid(activityUuid ?? "");
  // §472: from a player, only with their own activity.
  if ( !actsFor(user, activity?.actor) ) { console.warn(`${MODULE_ID} | stabilize query from ${user.name} refused: the activity is not theirs`); return false; }
  if ( !token?.actor || !contentOf(activity?.item).entry?.stabilizes ) return false;
  return stabilize(token.actor, { by: activity.actor?.name ?? "", with: activity.item.name });
}

/** `dnd5e.postUseActivity` on the author's client: the first target of the use message. */
async function onPostUse(activity, usageConfig, results) {
  if ( !contentOf(activity?.item).entry?.stabilizes || !activity.actor?.isOwner ) return;
  const first = results?.message?.system?.targets?.[0]?.token ?? Array.from(game.user.targets)[0]?.document?.uuid ?? null;
  const token = first ? await fromUuid(first) : null;
  if ( !token?.actor ) { log(`${activity.item.name}: no target to stabilize`); return; }
  const args = { target: token.uuid, activity: activity.uuid };
  const done = await viaOwnerOrGM(!!token.actor.isOwner, STABILIZE_QUERY, handleStabilize, args, { fallback: false });
  if ( done ) log(`${activity.item.name}: ${token.name} stabilized by ${activity.actor.name}`);
  else notice(token, loc("Retour.PasAStabiliser", { name: token.name }));
}

export function registerStabilize() {
  CONFIG.queries[STABILIZE_QUERY] = handleStabilize;
  route("dnd5e.postUseActivity", onPostUse, { label: "healer's kit: stabilization" });
}
