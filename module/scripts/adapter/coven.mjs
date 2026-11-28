/**
 * Covens (SPEC §19.5), read and written in Foundry: shared HP (content `sharedHp`) and second phase (`secondPhase`).
 *
 * Verified in dnd5e 6.0.3:
 *  - `dnd5e.damageActor` / `dnd5e.healActor` (data/actor/templates/attributes.mjs:679-716, `onUpdateHP`): on all clients,
 *    with the HP difference (`changes.hp`) and the original update (`changed`); `options.dnd5e.concentrationCheck === false`
 *    skips the Concentration check (line 700) — each member of a coven maintains their own Concentration;
 *  - the "transform" activity (data/activity/transform-data.mjs): `profiles[].uuid` (the form) — the native data that says
 *    "becomes this creature". The engine does not go through `Actor5e#transformInto` (documents/actor/actor.mjs:2846): for a
 *    linked actor (a unique NPC), it creates a new actor "X (Y)" every time.
 */

import { MODULE_ID } from "../constants.mjs";
import { sharedValue } from "../core/coven.mjs";
import { formExpired, revertSeconds, sharedSlotUpdates } from "../core/form-revert.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { tokenOf } from "./facts.mjs";
import { spendItemUses } from "./uses.mjs";

/** The flag carried by a reported HP write: it is not reported in turn. */
const SYNC = "hpSync";

/** The item that makes HP shared (`sharedHp`), or null. */
export function sharedHpItemOf(actor) {
  return actor?.items?.find(i => contentOf(i).entry?.sharedHp === true) ?? null;
}

/** An actor's second phase: the item, its "transform" activity, the form (uuid); or null. */
export function secondPhaseOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.secondPhase;
    if ( !rule ) continue;
    const activity = item.system.activities?.get(rule.activity);
    const uuid = activity?.profiles?.[0]?.uuid;
    if ( (activity?.type === "transform") && uuid ) return { item, activity, uuid, keepConditions: rule.keepConditions !== false, keepHp: rule.keepHp === true };
  }
  return null;
}

/** §76: the at-will form change that this activity's item declares (`changesForm`, the activity itself), or null. */
export function formChangeOf(activity) {
  const item = activity?.item;
  const rule = contentOf(item).entry?.changesForm;
  if ( !rule || (rule.activity !== activity.id) || (activity.type !== "transform") ) return null;
  const uuid = activity.profiles?.[0]?.uuid;
  return uuid ? { item, activity, uuid, keepConditions: rule.keepConditions !== false, keepHp: rule.keepHp === true,
    declared: true, revertAfter: rule.revertAfter ?? null, shareSpellSlots: rule.shareSpellSlots === true } : null;
}

/** At 0 HP, does the creature change form instead of falling? */
export const transformsAtZero = actor => !!secondPhaseOf(actor);

/** A write that the sharing itself made, or the transformation (which rewrites the form's HP): not to be reported. */
export function isSharedWrite(changed) {
  return foundry.utils.hasProperty(changed ?? {}, `flags.${MODULE_ID}.${SYNC}`)
    || foundry.utils.hasProperty(changed ?? {}, "flags.dnd5e.isPolymorphed");
}

/** The other members of this actor's coven, in its token's scene: one actor per member. */
export function covenMembers(actor) {
  const item = sharedHpItemOf(actor);
  const token = tokenOf(actor);
  const scene = (token?.document ?? token)?.parent;
  if ( !item || !scene ) return [];
  const group = identifierOf(item).id;
  const seen = new Set([actor.uuid]);
  const out = [];
  for ( const t of scene.tokens ) {
    const other = t.actor;
    if ( !other || seen.has(other.uuid) ) continue;
    const mine = sharedHpItemOf(other);
    if ( !mine || (identifierOf(mine).id !== group) ) continue;
    seen.add(other.uuid);
    out.push(other);
  }
  return out;
}

/**
 * Reports to the other members the HP difference that `actor` has just taken. Active GM. `members`: surveyed at the time
 * of the hit — at 0 HP, the second phase may already have given `actor`'s token back its new form (seen in play on 2026-09-26:
 * the fatal blow dealt to one member no longer passed to the others).
 * @returns {Promise<Array<{name: string, before: number, after: number}>>}
 */
export async function shareHp(actor, delta, members=covenMembers(actor)) {
  const done = [];
  for ( const other of members ) {
    const hp = other.system?.attributes?.hp;
    const next = sharedValue(hp, delta);
    if ( next === null ) continue;
    await other.update({ "system.attributes.hp.value": next, [`flags.${MODULE_ID}.${SYNC}`]: foundry.utils.randomID() },
      { dnd5e: { concentrationCheck: false } });
    done.push({ name: other.name, before: hp.value, after: next });
  }
  return done;
}

/** The conditions that say the fall or the HP: the new form does not take them over. */
const LEFT_BEHIND = new Set(["dead", "unconscious", "bloodied", "concentrating"]);

/**
 * The conditions that the new form keeps (by default, it keeps those of the previous form): a condition effect
 * placed by hand or by another creature (Paralyzed from a spell, Poisoned…), not an effect from its own items.
 */
function keptConditions(actor) {
  return actor.effects.filter(e => {
    const statuses = Array.from(e.statuses ?? []);
    if ( !statuses.length || statuses.some(id => LEFT_BEHIND.has(id)) ) return false;
    const origin = e.system?.origin?.item ?? e.system?.origin?.activity ?? e.origin ?? "";
    return !origin || !String(origin).startsWith(actor.uuid);
  }).map(e => { const data = e.toObject(); delete data._id; return data; });
}

/** The world actor of the form: itself, the one imported from this compendium, or imported now (same id). */
async function worldActorFor(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if ( !doc ) return null;
  if ( !doc.pack ) return doc;
  const found = game.actors.get(doc.id) ?? game.actors.find(a => a._stats?.compendiumSource === uuid);
  if ( found ) return found;
  return Actor.implementation.create({ ...doc.toObject(), _stats: { compendiumSource: uuid } }, { keepId: true });
}

/**
 * Second phase: the creature at 0 HP immediately takes the form of its profile, with its HP at maximum; it keeps its Initiative,
 * excess damage is lost, and it keeps its conditions (except `keepConditions: false`). The TOKEN changes actor (same document,
 * same combatant): no "transformed" actor created at each combat (dnd5e, `transformInto`, for a linked actor), no lost delta.
 * Active GM.
 * @returns {Promise<{from: string, to: string}|null>}
 */
export async function enterSecondPhase(actor) {
  const phase = secondPhaseOf(actor);
  return phase ? swapForm(actor, phase) : null;
}

/**
 * §76: the activity of an at-will form change (`changesForm`) has just been used: the creature takes its form, like
 * a second phase. Active GM.
 * @returns {Promise<{from: string, to: string}|null>}
 */
export async function changeForm(activity) {
  const phase = formChangeOf(activity);
  return phase ? swapForm(activity.actor, phase) : null;
}

/** §498: the token flag that keeps its original form, for the duration of a limited form change (`changesForm.revertAfter`). */
export const FORM_REVERT = "formRevert";

/** §498: what a token changed form for a time keeps of its original form (flag `formRevert`), or null. */
export const formRevertOf = token => (token?.document ?? token)?.getFlag?.(MODULE_ID, FORM_REVERT) ?? null;

/** An actor's spell slots, as plain data (`{ spell1: { value, max }, … }`): read before the token changes actor. */
function slotsOf(actor) {
  return Object.fromEntries(Object.entries(actor?.system?.spells ?? {})
    .map(([key, slot]) => [key, { value: Number(slot?.value) || 0, max: Number(slot?.max) || 0 }]));
}

/** The token of `actor` changes actor to the form `phase.uuid` (second phase or at-will change). */
async function swapForm(actor, phase) {
  const target = await worldActorFor(phase.uuid);
  const token = tokenOf(actor);
  const document = token?.document ?? token ?? null;
  if ( !target || !document ) {
    console.warn(`${MODULE_ID} | ${actor.name}: shape change impossible (${target ? "no token" : `form not found: ${phase.uuid}`})`);
    return null;
  }
  const proto = target.prototypeToken.toObject();
  const look = { actorLink: proto.actorLink, name: proto.name || target.name, texture: proto.texture, width: proto.width, height: proto.height, ring: proto.ring };
  // §498: a time-limited form keeps its original form on the token (actor, appearance, delta, HP) to return to it. Already
  // changed for a time: the origin stays the first; returned to it by another activity: the return no longer applies.
  let revert;
  const pending = formRevertOf(document);
  if ( pending && (pending.actorId === target.id) ) revert = null;
  else if ( pending ) revert = undefined;
  else if ( phase.declared && phase.revertAfter ) {
    const seconds = revertSeconds(phase.revertAfter, CONFIG.time?.roundTime);
    const src = document._source;
    revert = { actorId: document.actorId, actorLink: !!src.actorLink, name: src.name, texture: foundry.utils.deepClone(src.texture),
      width: src.width, height: src.height, ring: foundry.utils.deepClone(src.ring),
      delta: (!src.actorLink && src.delta) ? foundry.utils.deepClone(src.delta) : null,
      hp: Math.max(0, Number(actor.system.attributes?.hp?.value) || 0),
      expiresAt: (seconds === null) ? null : game.time.worldTime + seconds, auto: phase.revertAfter.auto !== false,
      keepHp: phase.keepHp, keepConditions: phase.keepConditions, shareSpellSlots: phase.shareSpellSlots,
      item: phase.item.name, form: target.name };
  }
  const done = await retoken(actor, document, target, look, { keepHp: phase.keepHp, keepConditions: phase.keepConditions,
    shareSpellSlots: phase.shareSpellSlots, revert });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token: document }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.SecondePhase", { from: done.from, to: target.name, item: phase.item.name })}</p>`,
    flags: { [MODULE_ID]: { secondPhase: { from: actor.uuid, to: target.uuid, token: document.uuid,
      ...(revert ? { until: revert.expiresAt } : {}), ...(done.slots ? { slots: done.slots } : {}) } } }
  });
  return { from: done.from, to: target.name, token: document, declared: !!phase.declared };
}

/**
 * The token `document` of `actor` switches to the actor `target`, with the appearance `look`: HP (kept if `keepHp`, otherwise
 * the given `hp` or the maximum), kept conditions (`keepConditions`), Concentration on the old form ended, shared spent slots
 * (`shareSpellSlots`, §498). `revert`: the `formRevert` flag to write (object), to remove (null) or to leave (undefined). `delta`:
 * the original delta to restore (return of an unlinked token). Active GM.
 */
async function retoken(actor, document, target, look, { keepHp=false, keepConditions=true, shareSpellSlots=false, hp=null, delta=null, revert=undefined }={}) {
  const from = actor.name;
  // §78: `keepHp` — the HP of the form being left (read before the swap), within the new form's maximum.
  const kept = keepHp ? Math.max(0, Number(actor.system.attributes?.hp?.value) || 0) : (Number.isFinite(hp) ? hp : null);
  const slots = shareSpellSlots ? slotsOf(actor) : null;
  // `keepConditions: false`: the new form takes over no condition from the old one.
  const conditions = keepConditions ? keptConditions(actor) : [];
  // Concentration on the old form ends (its effects on others with it, by dnd5e).
  // Dead or Unconscious that dnd5e may have placed on the old form (`updateDowned`): it does not fall, it changes.
  const fallen = actor.effects.filter(e => e.statuses?.has?.("concentrating") || e.statuses?.has?.("dead") || e.statuses?.has?.("unconscious")).map(e => e.id);
  if ( fallen.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", fallen);

  // A linked token has no delta to rewrite; an unlinked token starts from a blank delta — complete: the core refuses `delta: {}`
  // ("_id, system, items, effects, flags may not be undefined", seen in play on 2026-09-26). §78: a LINKED token that
  // becomes unlinked has no delta (null) — none is written, the core refuses that delta as a partial update;
  // it starts from the sheet. §498: on return, an unlinked token gets back the delta it had before the change.
  const blank = (look.actorLink || !document._source?.delta) ? {}
    : { delta: delta ? { system: {}, items: [], effects: [], flags: {}, ...foundry.utils.deepClone(delta), _id: document.delta?.id ?? document.id }
      : { _id: document.delta?.id ?? document.id, system: {}, items: [], effects: [], flags: {} } };
  await document.update({ actorId: target.id, ...look, ...blank, ...(revert ? { [`flags.${MODULE_ID}.${FORM_REVERT}`]: revert } : {}) });
  if ( revert === null ) await document.unsetFlag(MODULE_ID, FORM_REVERT);
  for ( const combatant of game.combats.contents.flatMap(c => c.combatants.filter(x => x.tokenId === document.id)) ) {
    await combatant.update({ actorId: target.id });
  }
  const shaped = document.actor;
  let shared = null;
  if ( shaped ) {
    const max = Number(shaped.system.attributes.hp.max) || 0;
    const value = (kept === null) ? max : Math.min(kept, max);
    // §498: slots spent under the old form stay spent under this one.
    shared = slots ? sharedSlotUpdates(slots, slotsOf(shaped)) : null;
    await shaped.update({ "system.attributes.hp.value": value, ...(shared ?? {}), [`flags.${MODULE_ID}.${SYNC}`]: foundry.utils.randomID() },
      { dnd5e: { concentrationCheck: false } });
    // With 0 HP kept (§78: the form that dies resumes its true form), the fall remains: Regeneration or death decide it.
    const downed = (value > 0) ? shaped.effects.filter(e => ["dead", "unconscious"].some(id => e.statuses?.has?.(id))).map(e => e.id) : [];
    if ( downed.length ) await shaped.deleteEmbeddedDocuments("ActiveEffect", downed);
    if ( conditions.length ) await shaped.createEmbeddedDocuments("ActiveEffect", conditions);
  }
  return { from, slots: shared };
}

/**
 * §498: the token resumes the original form kept by its `formRevert` flag — actor, appearance, delta of an unlinked token;
 * HP of the form being left if `keepHp` (within the maximum), otherwise those it had when leaving; conditions kept; shared slots.
 * `formReverted` chat card. Active GM.
 * @param {TokenDocument} document
 * @returns {Promise<{from: string, to: string, item: string}|null>}
 */
export async function revertToOrigin(document) {
  const snap = formRevertOf(document);
  const actor = document?.actor;
  if ( !snap || !actor ) return null;
  const target = game.actors.get(snap.actorId);
  if ( !target ) {
    console.warn(`${MODULE_ID} | ${document.name}: original form not found (${snap.actorId}), return dropped`);
    await document.unsetFlag(MODULE_ID, FORM_REVERT);
    return null;
  }
  const look = { actorLink: snap.actorLink, name: snap.name, texture: snap.texture, width: snap.width, height: snap.height, ring: snap.ring };
  const done = await retoken(actor, document, target, look, { keepHp: snap.keepHp, keepConditions: snap.keepConditions,
    shareSpellSlots: snap.shareSpellSlots, hp: snap.hp, delta: snap.delta, revert: null });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ token: document }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.FormeRetour.Carte", { from: foundry.utils.escapeHTML(done.from), to: foundry.utils.escapeHTML(document.name), item: foundry.utils.escapeHTML(snap.item ?? "") })}</p>`,
    flags: { [MODULE_ID]: { formReverted: { from: done.from, to: target.uuid, token: document.uuid, slots: done.slots ?? null } } }
  });
  return { from: done.from, to: document.name, item: snap.item ?? "" };
}

/** §498: the tokens (all scenes) whose limited form has exceeded its duration at world time `now`. */
export function expiredFormTokens(now=game.time.worldTime) {
  return game.scenes.contents.flatMap(scene => scene.tokens.filter(t => formExpired(formRevertOf(t)?.expiresAt, now)));
}

/** §498: `auto: false` — the reminder to the GM is done, the form stays until returned by hand. */
export const markReminded = document => document.setFlag(MODULE_ID, FORM_REVERT, { ...formRevertOf(document), expiresAt: null, reminded: true });

/* -------------------------------------------- */
/*  Dernier rempart (§19.6)                     */
/* -------------------------------------------- */

/** The last-stand item of an actor (content `lastStand`) that still has a use, or null. */
export function lastStandOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    if ( !contentOf(item).entry?.lastStand ) continue;
    const uses = item.system?.uses;
    const left = (uses?.max ?? "") === "" ? Infinity : (uses.value ?? (Number(uses.max) - (uses.spent ?? 0)));
    if ( left > 0 ) return item;
  }
  return null;
}

/** At 0 HP, does the creature stay standing (last stand still available)? */
export const standsAtZero = actor => !!lastStandOf(actor);

/**
 * Ends all effects that affect the actor: the effects placed on the actor (conditions, others' spells, Concentration, fall).
 * The passive effects of its items stay on the items (dnd5e 6, no copy onto the actor). Active GM.
 */
export async function purgeEffects(actor) {
  const ids = actor.effects.filter(e => !e.transfer).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

/**
 * Last stand at 0 HP: the creature drops to 1 HP instead of 0 — the Reaction played automatically (the GM would always want it),
 * a use spent, effects purged. Active GM.
 * @returns {Promise<string|null>}  The item's name, or null.
 */
export async function standAtOne(actor) {
  const item = lastStandOf(actor);
  if ( !item ) return null;
  const uses = item.system.uses ?? {};
  if ( (uses.max ?? "") !== "" ) await spendItemUses(item);
  await purgeEffects(actor);
  await actor.update({ "system.attributes.hp.value": 1, [`flags.${MODULE_ID}.${SYNC}`]: foundry.utils.randomID() },
    { dnd5e: { concentrationCheck: false } });
  const token = tokenOf(actor);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor, token: token?.document ?? token ?? undefined }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.DernierRempart", { item: item.name, name: actor.name })}</p>`,
    flags: { [MODULE_ID]: { lastStand: { item: item.uuid, actor: actor.uuid } } }
  });
  return item.name;
}
