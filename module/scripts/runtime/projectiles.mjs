/**
 * Projectiles (SPEC §16.27): Magic Missile, Scorching Ray, Eldritch Blast. dnd5e 6 makes only one per casting;
 * the text gives several (3 projectiles + 1 per level; 3 rays + 1 per level; 2 rays at level 5). Each
 * projectile is a separate casting, with its own dice — its attack roll if it has one, its damage.
 *  - Multiple aiming (ui/pointer.mjs): after the level choice, one click per projectile (`picks`); the first is the
 *    casting, the others are kept on its card (`projectileQueue`). Without multiple aiming (connector, several targets
 *    already chosen), the first goes to the first target and the author distributes the rest afterwards.
 *  - Those that hit automatically (Magic Missile): dnd5e's chained damage roll is cut off, the engine rolls them.
 *  - When the resolution of the first is settled, on the author's side, the engine chains each remaining projectile — same
 *    activity, no spell slot or Concentration, at the casting's level, at no action cost (`cost: "free"`), its attack
 *    roll attached to its card — waiting for each to be settled before the next.
 */

import { MODULE_ID } from "../constants.mjs";
import { allocateDarts } from "../core/action.mjs";
import { projectilesOf, projectileCount, handleAllocationQuery, leapOf } from "../adapter/projectiles.mjs";
import { distanceBetween, speakerTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { settledResolution } from "../adapter/messages.mjs";
import { suspendedUse } from "./suspended-uses.mjs";
import { handleNearSpace } from "./teleport.mjs";
import { relaunchUse } from "./relaunch.mjs";
import { antimagicBlocks } from "../adapter/antimagic.mjs";

const started = new Set();

/**
 * §16.27: the bounce of Chromatic Orb targets a creature within `radius` of the last target, never targeted by this casting;
 * otherwise it is refused (the aiming closes, the bounce is lost).
 */
export function leapProblem(activity, leap, target) {
  return leapRefused(activity, leap, target);
}

function leapRefused(activity, leap, target=[...game.user.targets][0]?.document) {
  const rule = leapOf(activity?.item);
  const from = leap.from ? fromUuidSync(leap.from, { strict: false }) : null;
  if ( !rule || !target || !from ) return false;
  if ( (leap.chain ?? []).includes(target.uuid) ) return loc("Rebond.DejaVise", { name: target.name });
  let limit = lengthIn(rule.radius, rule.units, from.parent.grid.units);
  if ( distanceBetween(from, target).value > limit + 1e-6 ) return loc("Rebond.TropLoin", { name: target.name, distance: limit, units: from.parent.grid.units });
  return false;
}

function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  const leap = usageConfig?.[MODULE_ID]?.leap;
  if ( leap ) {
    const refused = leapRefused(activity, leap);
    if ( refused ) {
      log(`bounce refused: ${refused}`);
      ui.notifications.warn(refused);
      notice([...game.user.targets][0]?.document, refused.replace(/^[^:]*:\s*/, ""));
      return false;
    }
    log(`${activity.item.name}: bounce toward ${[...game.user.targets][0]?.name ?? "?"}`);
    return true;
  }
  if ( usageConfig?.[MODULE_ID]?.projectileOf ) return true;
  const rule = projectilesOf(activity?.item);
  if ( !rule ) return true;
  // Each projectile is a separate casting, with its own dice: those that hit automatically (Magic Missile) have
  // their damage rolled by the engine (adapter/usage.mjs, `damage: "author"`), not by dnd5e's chained action.
  if ( rule.attack === false ) usageConfig.subsequentActions = false;
  // §16.27: the multiple aiming (ui/pointer) chose each projectile — the first is this casting, the others, in
  // click order, will be chained.
  const picks = usageConfig?.[MODULE_ID]?.picks;
  if ( picks?.length ) {
    if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.projectileQueue`, picks.slice(1));
    // dnd5e already surveyed all the card's targets (mixin.mjs:239-242, before this hook): the first only aims at its own.
    const captured = messageConfig?.data?.system?.targets;
    if ( Array.isArray(captured) ) messageConfig.data.system.targets = captured.filter(t => t.token === picks[0]);
    for ( const t of Array.from(game.user.targets) ) if ( t.document.uuid !== picks[0] ) t.setTarget(false, { releaseOthers: false, groupSelection: true });
    return true;
  }
  const targets = [...game.user.targets];
  if ( targets.length < 2 ) return true;
  if ( messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.projectileTargets`, targets.map(t => t.document.uuid));
  for ( const t of targets.slice(1) ) t.setTarget(false, { releaseOthers: false, groupSelection: true });
  return true;
}


/** The remaining rays, in order: distributed by the author, minus the one that already left for the first target. */
async function remainingShots(activity, usage, resolution, count) {
  // §403: "an attack against each" (Steel Wind Strike, `onePerTarget`) — never two on the same creature.
  const unique = !!projectilesOf(activity.item)?.onePerTarget;
  const first = resolution.targets?.[0]?.token ?? null;
  const designated = usage.getFlag(MODULE_ID, "projectileQueue");   // the multiple aiming already chose everything
  if ( Array.isArray(designated) ) return unique ? [...new Set(designated)].filter(t => t !== first).slice(0, count - 1) : [...designated];
  const listed = usage.getFlag(MODULE_ID, "projectileTargets") ?? (first ? [first] : []);
  if ( !listed.length ) return [];
  if ( unique ) return [...new Set(listed)].filter(t => t !== (first ?? listed[0])).slice(0, count - 1);
  let counts = { [listed[0]]: count };
  if ( listed.length > 1 ) {
    const targets = await Promise.all(listed.map(async token => ({ token, name: (await fromUuid(token))?.name ?? token })));
    ui.notifications.info(loc("Repartition.Rayons", { item: activity.item.name, count }));
    const answer = await handleAllocationQuery({ item: activity.item.name, count, targets });
    counts = allocateDarts(count, listed, answer?.counts ?? {});
  }
  const queue = listed.flatMap(token => Array(counts[token] ?? 0).fill(token));
  const gone = queue.indexOf(first ?? listed[0]);
  if ( gone >= 0 ) queue.splice(gone, 1);
  else queue.pop();
  return queue;
}

/**
 * §448: a chained projectile spends nothing — no spell slot, no spell resource, nor that of the item that cast it. A spell cast
 * by an item ("cast" activity: Wand of Magic Missiles) is a cached spell (`cachedFor`); dnd5e consumes the
 * targets of the linked activity there (`config.cause`, dnd5e.mjs:19203, :19300) — one wand charge per projectile, seen on
 * the test bench on 2026-11-14 (3 charges for a casting of 3 projectiles).
 * @param {Activity} activity
 */
export function chainedConsumption(activity) {
  const cached = !!activity?.item?.getFlag?.("dnd5e", "cachedFor");
  return { consume: { action: false, resources: false, spellSlot: false }, ...(cached ? { cause: { resources: false } } : {}) };
}

async function chain(usage, resolution) {
  const scaled = usage.getAssociatedActivity?.({ scaled: true });
  const base = usage.getAssociatedActivity?.();
  if ( !scaled || !base ) return;
  const count = projectileCount(scaled);
  if ( count < 2 ) return;
  const queue = await remainingShots(scaled, usage, resolution, count);
  const level = base.item.system.level ?? 0;
  const scaling = Number(usage.system?.scaling) || 0;
  log(`${base.item.name}: ${count} projectile(s), ${queue.length} chained`);
  for ( const tokenUuid of queue ) {
    const token = (await fromUuid(tokenUuid))?.object;
    if ( !token ) continue;
    token.setTarget(true, { releaseOthers: true });
    const config = {
      ...chainedConsumption(base),
      concentration: { begin: false },
      subsequentActions: false,
      ...(level > 0 ? { scaling, spell: { slot: `spell${level + scaling}` } } : {}),
      // §448: the first was forced in an antimagic field (otherwise it would not have left) — the next too, with no new window.
      [MODULE_ID]: { confirmed: true, cost: "free", projectileOf: usage.id, ...(antimagicBlocks(base) ? { antimagicForced: true } : {}) }
    };
    const flags = { data: { flags: { [MODULE_ID]: { projectileOf: usage.id } } } };
    let used = await relaunchUse(base, config, { configure: false }, flags);
    // A gate suspended this projectile to ask its question (Portent, a reaction before the attack): it relaunches it itself,
    // attack roll included. We wait for its relaunch; without it, the third ray never left.
    const gated = !used?.message ? suspendedUse(base.uuid) : null;
    if ( gated ) used = await gated;
    if ( !used?.message ) break;
    if ( !gated && projectilesOf(base.item)?.attack ) {
      await base.rollAttack({}, { configure: false }, { data: { system: { origin: used.message.id } } });
    }
    await settledResolution(used.message.id, { timeout: 30000, every: 300 });
  }
  // §402: "you can then teleport… to within 5 feet of one of the targets" (Steel Wind Strike) — on this client, the author.
  const near = projectilesOf(base.item)?.teleportNear;
  const caster = speakerTokenOf(usage) ?? usage.getAssociatedActor?.()?.getActiveTokens?.(false, true)?.[0] ?? null;
  const struck = [...new Set([resolution.targets?.[0]?.token, ...queue].filter(Boolean))];
  if ( near && caster && struck.length ) {
    await handleNearSpace({ token: caster.uuid, distance: near.distance, units: near.units, item: base.item.name, near: struck })
      .catch(err => log(`${base.item.name}: no teleport after the attacks (${err.message})`));
  }
}

/** On the author's side: the resolution of the first projectile is settled — the others are chained, once. */
function onResolutionFlag(message, changes) {
  const diff = changes.flags?.[MODULE_ID]?.resolution;
  if ( !diff || !("step" in diff) || !message.isAuthor ) return;
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !["done", "missed"].includes(resolution?.step) ) return;
  const usage = game.messages.get(resolution.origin ?? message.id) ?? message;
  if ( usage.getFlag(MODULE_ID, "projectileOf") || started.has(usage.id) ) return;
  if ( !projectilesOf(usage.getAssociatedActivity?.()?.item) ) return;
  started.add(usage.id);
  chain(usage, resolution).catch(err => console.error(`${MODULE_ID} | chained projectiles`, err));
}

/**
 * Intent "cast with these projectiles" (multiple aiming, ui/pointer.mjs): the suspended use resumes, the level
 * already chosen, each projectile chosen (`picks`, token uuids in click order).
 */
export function castWithPicks(activity, [config, dialog, message], picks) {
  // dnd5e freezes the targets in the message configuration from the first use (activity/mixin.mjs:239-242) — the one
  // that was suspended for aiming, with no target: we let them be re-read (like runtime/actions.mjs, `engage`).
  const messageConfig = foundry.utils.deepClone(message ?? {});
  if ( messageConfig.data?.system ) delete messageConfig.data.system.targets;
  return relaunchUse(activity, { ...config, [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), picks } }, dialog, messageConfig);
}

/** To register after the mouse (the aiming chose the targets) and before legality. */
export function registerProjectiles() {
  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "projectiles: one per target, the rest chained" });
  route("updateChatMessage", onResolutionFlag, { label: "chained projectiles" });
}
