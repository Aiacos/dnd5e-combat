/**
 * Applying a resolution to a token: the activity's effects (taken from the compendium if missing), pushes, conditions,
 * marks, effect removal. Extracted from adapter/saves.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { currentTurnKey } from "./turn.mjs";
import { effectKey, poolEffectsOf } from "./usage.mjs";
import { pushOf } from "./basics.mjs";
import { blockedFor } from "./eligibility.mjs";
import { conditionImmunitiesAgainst } from "./facts.mjs";
import { activityFor } from "./saves.mjs";

/**
 * §71: the effect that an activity profile cites, absent from the world item — the "Shadow Dagger" of a "Vampire Familiar"
 * imported on 2026-10-04 had lost it (the activity kept the profile `dsK5sPtkUMySmyvw`, the item no longer had an effect).
 * We take it from the sheet of origin (compendium): same actor (`_stats.compendiumSource`, otherwise an actor compendium
 * that has its id), same item, same effect.
 * The compendium effect applies as is (dnd5e notes its source, effect-application.mjs:237). Nothing written to the sheet.
 * §154: first the source of the item itself — Kaalisti's Mirror Image in `dnd-6` (spell from the Player's Handbook, copied onto a
 * character sheet) cited three effects it no longer had; the compendium spell has them, under the same ids.
 */
async function lostEffectOf(activity, effectId) {
  const item = activity?.item;
  const actor = item?.actor;
  if ( !item || !actor ) return null;
  const own = [item._stats?.compendiumSource, item.flags?.core?.sourceId].filter(u => typeof u === "string" && u.startsWith("Compendium."));
  for ( const uuid of own ) {
    const effect = (await fromUuid(uuid).catch(() => null))?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from the item's source (${uuid}): the world item lost it`); return effect; }
  }
  const base = actor.isToken ? (actor.baseActor ?? actor) : actor;
  const sources = [base._stats?.compendiumSource, base.flags?.core?.sourceId].filter(u => typeof u === "string" && u.startsWith("Compendium."));
  for ( const uuid of sources ) {
    const source = await fromUuid(uuid).catch(() => null);
    const effect = source?.items?.get(item.id)?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from the source sheet (${uuid}): the world item lost it`); return effect; }
  }
  for ( const pack of game.packs.filter(p => p.documentName === "Actor") ) {
    if ( !pack.index.has(base.id) ) continue;
    const source = await pack.getDocument(base.id).catch(() => null);
    const effect = source?.items?.get(item.id)?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from ${pack.collection}: the world item lost it`); return effect; }
  }
  // Survey of the gaps (2026-10-22): neither source nor sheet of origin found — the pre-generated Barbarian's Rage of the
  // Player's Handbook, copied under another id, cites the effect `G5XZTi4zYTFiHVll` without carrying it. A compendium item
  // with the same identifier that has this effect under this id.
  const identifier = item.system?.identifier;
  for ( const pack of identifier ? game.packs.filter(p => p.documentName === "Item") : [] ) {
    const index = await pack.getIndex({ fields: ["system.identifier"] }).catch(() => null);
    for ( const entry of index?.filter?.(e => e.system?.identifier === identifier) ?? [] ) {
      const effect = (await pack.getDocument(entry._id).catch(() => null))?.effects?.get(effectId);
      if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from ${pack.collection} (same identifier): the world item lost it`); return effect; }
    }
  }
  return null;
}

export async function applyEffectsToToken(usageMessage, tokenUuid, refs) {
  if ( !refs.length ) return [];
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return [];
  const tray = document.createElement("effect-application");
  tray.chatMessage = usageMessage;
  const applied = [];
  for ( const ref of refs ) {
    const activity = activityFor(usageMessage, ref.activity);
    // §37: a pool effect (`choice.pool`) is not an activity profile.
    const profile = [...(activity?.effects ?? []), ...poolEffectsOf(activity)].find(e => effectKey(e) === ref.id);
    const own = await profile?.getEffect();
    const effect = own ?? (profile ? await lostEffectOf(activity, ref.id) : null);
    if ( !effect ) {
      console.log(`${MODULE_ID} | effect ${ref.id} not found on ${activity?.item?.name ?? ref.activity}, nor on its source sheet`);
      continue;
    }
    // §16.8: immune to one of its conditions, the creature does not receive the effect (Hypnotic Pattern without Charmed).
    if ( blockedFor(effect, actor, activity?.actor ?? usageMessage.getAssociatedActor?.() ?? null).length ) continue;
    const result = await tray._applyEffectToActor(effect, actor);
    // Survey of the gaps: an effect taken from a compendium has the compendium item as its origin — the engine would no
    // longer attach it to the sheet's item (`originItemOf`: Fanatical Focus "in Rage", auras, effect endings).
    // The origin becomes the world item again.
    if ( result?.uuid && !own && activity?.item && (result.origin !== activity.item.uuid) ) await result.update({ origin: activity.item.uuid }).catch(() => null);
    if ( result?.uuid ) applied.push(result.uuid);
  }
  return applied;
}

/**
 * Separates from the plan's effects those that are pushes (the Shove's "pushed away",
 * content/actions.mjs): they are not placed, the engine moves the target.
 * @returns {Promise<{effects: Array<{id: string, activity: string}>, pushes: object[]}>}
 */
export async function splitPushes(usageMessage, refs) {
  const effects = [];
  const pushes = [];
  for ( const ref of refs ) {
    const activity = activityFor(usageMessage, ref.activity);
    // §37: a pool effect (`choice.pool`) is not an activity profile.
    const profile = [...(activity?.effects ?? []), ...poolEffectsOf(activity)].find(e => effectKey(e) === ref.id);
    const push = pushOf(await profile?.getEffect());
    if ( push ) pushes.push(push);
    else effects.push(ref);
  }
  return { effects, pushes };
}

/**
 * Places a native condition on the target (SPEC §16, `status` step: Prone from Sleet Storm, Grappled from a
 * bite…), with the activity as origin — `hasEffectFrom` finds it again, and cancellation removes it like
 * an activity effect. The core's `Actor#toggleStatusEffect` (client/documents/actor.mjs:547); a condition
 * already carried is not doubled. Returns the UUID of the created effect, or null.
 */
export async function applyStatusToToken(usageMessage, tokenUuid, status, { escapeDc=null }={}) {
  const tokenDoc = await fromUuid(tokenUuid);
  const actor = tokenDoc?.actor;
  const tokenScene = tokenDoc?.parent?.documentName === "Scene" ? tokenDoc.parent.id : null;
  if ( !actor || !CONFIG.statusEffects.some(s => s.id === status) ) return null;
  if ( actor.statuses.has(status) ) return null;
  const activity = usageMessage.getAssociatedActivity?.();
  // §16.8: immune, nothing is placed; §268: including against this source (Protection from Evil and Good).
  if ( conditionImmunitiesAgainst(actor, activity?.actor ?? null).includes(status) ) return null;
  const effect = await actor.toggleStatusEffect(status, { active: true });
  if ( !effect?.uuid ) return null;
  // A condition is a `condition` effect, whose dnd5e model removes `system.origin` (data/active-effect/
  // condition.mjs:12): the origin goes in the core's `origin` field, which `originItemOf` reads as a fallback.
  // §157: the turn of placement is noted, as for an item effect (runtime/cantrips.mjs) — "until the end of your next turn".
  if ( activity ) await effect.update({ origin: activity.uuid, ...(game.combat?.started ? { [`flags.${MODULE_ID}.placedOn`]: currentTurnKey() } : {}),
    // §504 (B24): the escape DC that the rule declares ("DC 11 to escape"), read by `escapeDcOf`.
    ...(escapeDc ? { [`flags.${MODULE_ID}.escapeDc`]: escapeDc } : {}),
    // The scene of the targeted token: a linked actor has tokens on several scenes (adapter/grapple.mjs `grappleSceneOf`).
    ...(tokenScene ? { [`flags.${MODULE_ID}.scene`]: tokenScene } : {}) });
  return effect.uuid;
}

/**
 * §54: a mark (`mark` outcome step) — a named effect, with the item's image, attached to the activity and to the use
 * message (the item may be destroyed: a thrown flask of oil), with a duration in seconds. A mark already there is replaced.
 */
export async function applyMarkToToken(usageMessage, tokenUuid, step, label) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  const old = actor.effects.filter(e => e.getFlag(MODULE_ID, "mark") === step.mark).map(e => e.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const activity = usageMessage.getAssociatedActivity?.();
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label, img: activity?.item?.img ?? "icons/svg/aura.svg", type: "base", origin: activity?.uuid ?? null,
    system: { origin: { activity: activity?.uuid ?? null, message: usageMessage.uuid } },
    duration: step.seconds ? { seconds: step.seconds } : {},
    flags: { [MODULE_ID]: { mark: step.mark } }
  }]);
  return effect?.uuid ?? null;
}

/** Removes the effects placed by a resolution (cancellation). */
export async function removeEffects(uuids) {
  for ( const uuid of uuids ) await (await fromUuid(uuid))?.delete();
}
