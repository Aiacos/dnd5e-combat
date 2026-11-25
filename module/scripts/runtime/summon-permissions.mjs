/**
 * §542 (issue #43): a player who cannot summon is told why, and so is the GM.
 *
 * Without "Create New Tokens" (`TOKEN_CREATE`) or the dnd5e world setting "Allow Summoning", dnd5e hides the summon part of the usage
 * window and never places the creature (`SummonActivity#canSummon`, dnd5e 6.1.1 dnd5e.mjs:41329; `_prepareUsageConfig` sets
 * `create.summons` from it, dnd5e.mjs:41342). The first summon of a compendium creature also needs "Create New Actors"
 * (`Actor5e.fetchExisting` throws, dnd5e.mjs:43886). Nothing warned anyone (Discord, 2026-11-25).
 *
 * After the use (`dnd5e.postUseActivity`, dnd5e.mjs:18994, on the client that used it): a summon activity that would have placed its
 * creature (`summon.prompt`, or content `placesSummons`) but cannot → a warning for the user and a GM alert (runtime/gm-alert.mjs, the
 * whispered card and the banner) that names the missing right. Nothing is blocked: the spell is cast as before.
 *
 * The load-time window for the GM is ui/summon-permissions.mjs; the read-only diagnostic check is in diagnostic/checks.mjs.
 */
import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { allowSummoning, needsImport, summonRightsOf } from "../adapter/summon-permissions.mjs";
import { summonBlocker } from "../core/summon-permissions.mjs";
import { alertGM } from "./gm-alert.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

/** The GM is told once per user, item and reason in a session (the player is told every time). */
const told = new Set();

/** True when this use meant to place a creature. */
function meantToPlace(activity, usageConfig) {
  if ( activity?.type !== "summon" || !activity.availableProfiles?.length ) return false;
  if ( usageConfig?.[MODULE_ID]?.placeSummons === false ) return false;   // §116: the caller places the creatures itself
  return (activity.summon?.prompt === true) || (contentOf(activity.item).entry?.placesSummons === true);
}

/**
 * Why `user` cannot place the creature of this summon, or null.
 * @param {Activity} activity
 * @param {User} user
 * @param {string|null} profileId  the profile chosen in the usage window, if any
 */
export function blockerFor(activity, user, profileId=null) {
  return summonBlocker({ ...summonRightsOf(user), allowSummoning: allowSummoning(), needsImport: needsImport(activity, profileId) });
}

/**
 * Tells the GM (alert card + banner) that `user` could not summon with this activity. Returns the alert message id, or null (alerts
 * off, already told this session, no active GM).
 */
export async function tellGM(activity, user, blocker, { once=true }={}) {
  const key = `${user?.id}:${activity?.uuid}:${blocker}`;
  if ( once && told.has(key) ) return null;
  told.add(key);
  const text = loc(`Invocation.Droits.MJ.${blocker}`, { player: user?.name ?? "", item: activity?.item?.name ?? "" });
  return alertGM({ text, item: activity?.item ?? null, actor: activity?.actor ?? null });
}

async function onPostUse(activity, usageConfig) {
  if ( !meantToPlace(activity, usageConfig) || !canvas?.scene ) return;
  const blocker = blockerFor(activity, game.user, usageConfig?.summons?.profile ?? null);
  if ( !blocker ) return;
  log(`${activity.item.name}: ${game.user.name} cannot place the summoned creature (${blocker})`);
  ui.notifications.warn(loc(`Invocation.Droits.Joueur.${blocker}`, { item: activity.item.name }));
  await tellGM(activity, game.user, blocker);
}

export function registerSummonPermissions() {
  route("dnd5e.postUseActivity", onPostUse, { label: "summon permissions: player not told" });
}
