/**
 * §118: a summon cast ON targets, taken over by a neighbouring module. *Animate Dead* (PHB 2024) is a "summon" activity
 * (Skeleton / Zombie profiles) that targets a corpse; *Finger of Death* has a second one, "Raise a zombie". dnd5e
 * would place a new creature next to it; a module that knows how to transform the target itself (a corpse raised in its place)
 * says so here.
 *
 * On the casting client, at `dnd5e.preUseActivity` (after the aiming: the targets are designated), the engine calls
 * `Hooks.callAll("dnd5e-combat.summonOnTargets", takers, { activity, caster, targets })`. A module that takes charge pushes into
 * `takers` a function `async ({ profile }) => boolean` (the profile chosen in dnd5e's window, `activity.profiles[]`) —
 * true: it took charge (done, or refused with its own message). If there is one, dnd5e's placement is skipped
 * (`dnd5e.preSummon`, documents/activity/summon.mjs:138, cancelled); at `dnd5e.postUseActivity` (mixin.mjs:307: slot spent, card
 * published) the takers are called in order, the first that answers true wins. If none succeeds (error or false), dnd5e's
 * ordinary placement is relaunched (`placeSummons`), if this client has the right to summon. The takeover does not depend on that
 * right (`canSummon`, summon.mjs:54: token creation + "Allow Summoning"): a neighbour can have the GM do the summoning. The
 * engine names no module (same shape as `dropItems`, adapter/orders.mjs).
 */
import { MODULE_ID } from "../constants.mjs";
import { summonOwnership } from "../core/summon.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { contentOf } from "../adapter/content.mjs";
import { relaunchUse } from "./relaunch.mjs";

/**
 * The summons taken over in progress, by activity uuid (the rescaled activity keeps its id): `{ takers, at }`. A use
 * cancelled after the request (legality, window closed) never reaches `postUseActivity`: after this delay, the takeover
 * is forgotten and the card's "Summon" button places normally again.
 */
const claimed = new Map();
const CLAIM_TTL_MS = 120_000;

function liveClaim(activity) {
  const claim = claimed.get(activity?.uuid);
  if ( claim && ((Date.now() - claim.at) > CLAIM_TTL_MS) ) claimed.delete(activity.uuid);
  return claimed.get(activity?.uuid) ?? null;
}

function onPreUse(activity) {
  if ( activity?.type !== "summon" ) return;
  claimed.delete(activity.uuid);
  const caster = activity.getUsageToken?.() ?? null;
  const targets = Array.from(game.user.targets).map(t => t.document).filter(t => t && (t !== caster));
  if ( !targets.length ) return;
  const takers = [];
  // §118: on the client that casts a summon with designated targets: `(takers, { activity, caster, targets })`. A module that
  // transforms the targets pushes into `takers` an `async ({ profile }) => boolean`; dnd5e's placement is then skipped (see
  // the header).
  Hooks.callAll(`${MODULE_ID}.summonOnTargets`, takers, { activity, caster, targets });
  const kept = takers.filter(t => typeof t === "function");
  if ( kept.length ) claimed.set(activity.uuid, { takers: kept, at: Date.now() });
}

/** dnd5e is about to place the summon: a neighbour has taken it over, we place nothing. */
function onPreSummon(activity) {
  return liveClaim(activity) ? false : undefined;
}

function onPostUse(activity, usageConfig) {
  const claim = liveClaim(activity);
  if ( !claim ) return;
  const takers = claim.takers;
  claimed.delete(activity.uuid);
  const options = usageConfig?.summons ?? {};
  const profile = activity.profiles?.find(p => p._id === options.profile) ?? activity.availableProfiles?.[0] ?? null;
  return handOver(activity, options, profile, takers);
}

async function handOver(activity, options, profile, takers) {
  for ( const take of takers ) {
    try { if ( (await take({ profile })) === true ) return; }
    catch(err) { console.warn(`${MODULE_ID} | summon on targets: a neighbouring module failed`, err); }
  }
  // Nobody succeeded: dnd5e's ordinary placement (nothing is claimed any more for this activity).
  if ( activity.canSummon && canvas.scene && profile ) await activity.placeSummons({ ...options, profile: profile._id });
}

/**
 * §197: a GM summons from a player's sheet (Find Steed cast "to test", issue #9) — dnd5e creates the actor in their name
 * (`Actor5e.fetchExisting`, documents/actor/actor.mjs:461), and the player can neither move nor use the creature. After the
 * placement
 * (`dnd5e.postSummon`, documents/activity/summon.mjs:217, on the summoning client), the caster's owner players become
 * owners of the summoned actor (the world actor: an unlinked token inherits it). A player who summons themself is already
 * its owner: nothing to do.
 */
async function onPostSummon(activity, profile, tokens) {
  if ( !game.user.isGM ) return;
  const caster = activity?.actor;
  if ( !caster ) return;
  // O8f (§349): a hostile summon belongs to no one (adapter/summons.mjs, `makeSummonHostile`).
  if ( contentOf(activity.item).entry?.summon?.hostile === true ) return;
  const isGM = id => game.users.get(id)?.isGM === true;
  const seen = new Set();
  for ( const token of tokens ?? [] ) {
    const doc = token?.document ?? token;
    const actor = (doc?.actorLink === false) ? (doc.baseActor ?? game.actors.get(doc.actorId)) : doc?.actor;
    if ( !actor || actor.pack || seen.has(actor) ) continue;
    seen.add(actor);
    const ownership = summonOwnership(caster.ownership, actor.ownership, isGM);
    if ( !ownership ) continue;
    await actor.update({ ownership });
    log(`${actor.name}: summoned by the GM for ${caster.name}, now owned by its players too`);
  }
}

export function registerSummonHandover() {
  route("dnd5e.preUseActivity", onPreUse, { label: "summon on targets: neighbours asked" });
  route("dnd5e.preSummon", onPreSummon, { cancellable: true, label: "summon on targets: handed to a neighbouring module" });
  route("dnd5e.postUseActivity", onPostUse, { label: "summon on targets: neighbour summons" });
  route("dnd5e.postSummon", (activity, profile, tokens) => { onPostSummon(activity, profile, tokens).catch(err => console.error(`${MODULE_ID} | summon owners`, err)); },
    { label: "summon: the caster's players not made owners" });
}

/**
 * §383 (issue #38): intention "summon this form" ("Choose the form" window, ui/summon-form.mjs) — the suspended use
 * restarts as it is (slot chosen in the bar, consumptions), without dnd5e's window, with the chosen form
 * (`usageConfig.summons`, read by `placeSummons`, documents/activity/summon.mjs) and marked chosen (`summonForm`) so as not to
 * ask again.
 * @param {Activity} activity
 * @param {[object, object, object]} usage
 * @param {{ profile: string, creatureSize?: string, creatureType?: string, slot?: string, count?: number }} choice
 */
export function castWithForm(activity, [config, dialog, message], choice) {
  // §385: the level (slot) and the number chosen in the same window, when it asked for them.
  const { slot=undefined, count=null, ...summons } = choice ?? {};
  const use = { ...config, summons: { ...(config?.summons ?? {}), ...summons },
    ...(slot ? { spell: { ...(config?.spell ?? {}), slot } } : {}),
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), summonForm: true, ...(count ? { summonCount: count } : {}) } };
  log(`${activity.item?.name}: form chosen (${activity.profiles?.find(p => p._id === choice.profile)?.name || choice.profile})`);
  return relaunchUse(activity, use, { ...(dialog ?? {}), configure: false }, message);
}

/**
 * §391: intention "take this profile" (enchantment, transformation) — the use restarts as it is, without dnd5e's window,
 * with the chosen profile (`enchantmentProfile` or `transform.profile`, documents/activity/enchant.mjs and transform.mjs) and
 * marked chosen.
 */
export function castWithProfile(activity, [config, dialog, message], choice) {
  const use = { ...config, ...choice, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), summonForm: true } };
  log(`${activity.item?.name}: profile chosen (${choice?.enchantmentProfile ?? choice?.transform?.profile})`);
  return relaunchUse(activity, use, { ...(dialog ?? {}), configure: false }, message);
}
