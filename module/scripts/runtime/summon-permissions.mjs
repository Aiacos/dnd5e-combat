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
 *
 * §552 (Discord "Summon spells", 2026-11-26): with every right granted, a summon can still place nothing without a word — an item
 * whose Summon activity has no creature profile, none at this cast level, a chosen profile that names no creature, or no scene
 * (core/summon-permissions.mjs `summonDataProblem`). Same telling: a warning for the caster, a GM alert that names the item.
 */
import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { allowSummoning, needsImport, summonRightsOf } from "../adapter/summon-permissions.mjs";
import { summonBlocker, summonDataProblem } from "../core/summon-permissions.mjs";
import { alertGM } from "./gm-alert.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

/** The GM is told once per user, item and reason in a session (the player is told every time). */
const told = new Set();

/** True when this summon activity places its creature on use (dnd5e's `summon.prompt`, or content `placesSummons`). */
function placesOnUse(activity, usageConfig) {
  if ( activity?.type !== "summon" ) return false;
  if ( usageConfig?.[MODULE_ID]?.placeSummons === false ) return false;   // §116: the caller places the creatures itself
  return (activity.summon?.prompt === true) || (contentOf(activity.item).entry?.placesSummons === true);
}

/** True when this use meant to place a creature. */
function meantToPlace(activity, usageConfig) {
  return placesOnUse(activity, usageConfig) && !!activity.availableProfiles?.length;
}

/**
 * §552: why this use placed nothing although no right is missing, or null (`results.summoned`: the tokens dnd5e placed,
 * documents/activity/summon.mjs `_finalizeUsage`).
 */
export function dataProblemOf(activity, usageConfig, results=null) {
  if ( activity?.type !== "summon" || (usageConfig?.[MODULE_ID]?.placeSummons === false) ) return null;
  const chosen = activity.profiles?.find(p => p._id === usageConfig?.summons?.profile) ?? activity.availableProfiles?.[0] ?? null;
  return summonDataProblem({
    profiles: activity.profiles?.length ?? 0,
    available: activity.availableProfiles?.length ?? 0,
    meantToPlace: placesOnUse(activity, usageConfig),
    placing: usageConfig?.create?.summons === true,
    crMode: activity.summon?.mode === "cr",
    chosenHasCreature: !!chosen?.uuid,
    scene: !!canvas?.scene,
    placed: results?.summoned?.length ?? 0
  });
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
export async function tellGM(activity, user, blocker, { once=true, group="Droits" }={}) {
  const key = `${user?.id}:${activity?.uuid}:${blocker}`;
  if ( once && told.has(key) ) return null;
  told.add(key);
  // §552: `group` "Donnees" for a data problem (`dataProblemOf`), "Droits" for a missing right.
  const text = loc(`Invocation.${group}.MJ.${blocker}`, { player: user?.name ?? "", item: activity?.item?.name ?? "" });
  return alertGM({ text, item: activity?.item ?? null, actor: activity?.actor ?? null });
}

async function onPostUse(activity, usageConfig, results) {
  if ( activity?.type !== "summon" ) return;
  const blocker = (meantToPlace(activity, usageConfig) && canvas?.scene) ? blockerFor(activity, game.user, usageConfig?.summons?.profile ?? null) : null;
  if ( blocker ) {
    log(`${activity.item.name}: ${game.user.name} cannot place the summoned creature (${blocker})`);
    ui.notifications.warn(loc(`Invocation.Droits.Joueur.${blocker}`, { item: activity.item.name }));
    await tellGM(activity, game.user, blocker);
    return;
  }
  // §552: nothing missing on the user's side, and still nothing placed — say why.
  const problem = dataProblemOf(activity, usageConfig, results);
  if ( !problem ) return;
  log(`${activity.item.name}: nothing summoned (${problem}, mode "${activity.summon?.mode ?? ""}", ${activity.profiles?.length ?? 0} profile(s), `
    + `${activity.availableProfiles?.length ?? 0} at this level)`);
  ui.notifications.warn(loc(`Invocation.Donnees.Joueur.${problem}`, { item: activity.item.name }));
  await tellGM(activity, game.user, problem, { group: "Donnees" });
}

export function registerSummonPermissions() {
  route("dnd5e.postUseActivity", onPostUse, { label: "summon permissions / data: caster not told" });
}
