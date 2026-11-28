/**
 * Covens (SPEC §19.5): shared HP and second phase, on the active GM. Reading and writing are in adapter/coven.mjs,
 * the HP carry-over in core/coven.mjs.
 */

import { sharedHpItemOf, shareHp, isSharedWrite, transformsAtZero, enterSecondPhase, covenMembers, standsAtZero, standAtOne,
  purgeEffects, formChangeOf, changeForm, formRevertOf, revertToOrigin, expiredFormTokens, markReminded } from "../adapter/coven.mjs";
import { contentOf } from "../adapter/content.mjs";
import { MODULE_ID } from "../constants.mjs";
import { actsFor } from "../core/requests.mjs";
import { log, sleep, say, locEsc, notice, viaActiveGM } from "./shared.mjs";
import { burstAtZero } from "./emanations.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { AFTER_ZERO_HP_MS } from "../adapter/death.mjs";

/** One queue for all covens: two deltas carried over one after the other do not overwrite each other. */
const QUEUE = "coven";

/** The creatures whose second phase is under way: a single pass per creature. */
const shifting = new Set();

/** A member lost or regained HP (damage, healing, token bar): the others follow. */
function onHpChanged(actor, changes, changed) {
  if ( !changes?.hp || isSharedWrite(changed) || !sharedHpItemOf(actor) ) return;
  const members = covenMembers(actor);   // now: at 0 HP, the second phase will return this token to another form
  return enqueue(QUEUE, async () => {
    const done = await shareHp(actor, changes.hp, members);
    for ( const d of done ) log(`coven: ${d.name} follows ${actor.name} (${changes.hp > 0 ? "+" : ""}${changes.hp} HP: ${d.before} → ${d.after})`);
  });
}

/** An actor has just dropped to 0 HP: if it has a second phase, it changes form instead of falling (§17.1 lets it). */
function onZero(actor) {
  if ( !actor || shifting.has(actor.uuid) || !(transformsAtZero(actor) || standsAtZero(actor)) ) return;
  shifting.add(actor.uuid);
  return enqueue(QUEUE, async () => {
    try {
      // dnd5e sets Dead on the client that wrote the HP (`updateDowned`): we give it time, the phase removes it.
      await sleep(AFTER_ZERO_HP_MS);
      if ( (actor.system?.attributes?.hp?.value ?? 1) > 0 ) return;
      // §19.6: the last stand comes before everything — it does not fall.
      const stood = await standAtOne(actor);
      if ( stood ) return log(`${stood}: ${actor.name} stays up at 1 HP`);
      await burstAtZero(actor);   // §19.6: burst at 0 HP, before the switch
      const done = await enterSecondPhase(actor);
      if ( done ) log(`second phase: ${done.from} → ${done.to}`);
    } finally { shifting.delete(actor.uuid); }
  });
}

/** §19.6: a last bulwark's activity has just been used (reaction at 50 HP or fewer): everything that affected it ends. */
async function onLastStandUsed(activity) {
  const actor = activity?.actor;
  if ( !actor || !contentOf(activity.item).entry?.lastStand ) return;
  const n = await purgeEffects(actor);
  log(`${activity.item.name}: ${n} effect(s) removed from ${actor.name}`);
  await say({ actor }, locEsc("EffetsPurges", { item: activity.item.name, name: actor.name }));
}

/** §76: a form revealed at will (`changesForm`) — the second phase's token swap, after the use. */
function onFormChange(activity) {
  const actor = activity?.actor;
  if ( !actor || !formChangeOf(activity) || shifting.has(actor.uuid) ) return;
  shifting.add(actor.uuid);
  return enqueue(QUEUE, async () => {
    try {
      const done = await changeForm(activity);
      if ( !done ) return;
      log(`shape change: ${done.from} → ${done.to}`);
      // §498: the form change seen and heard by the whole table.
      notice(done.token, { key: "FormeRetour.Change", data: { name: done.to } }, "info", { all: true, action: "formChange", outcome: "success" });
    } finally { shifting.delete(actor.uuid); }
  });
}

/** §498: the "revert to original form" request (token menu, owning player) to the active GM. */
export const REVERT_FORM_QUERY = `${MODULE_ID}.revertShape`;

/** §498: active GM side — the token reverts to its original form (duration elapsed, or at its owner's request). */
function handleRevertShape({ token: tokenUuid, reason="asked" }={}, { user }={}) {
  const document = fromUuidSync(tokenUuid ?? "", { strict: false });
  if ( !document || !formRevertOf(document) || !actsFor(user, document) ) return false;
  const key = document.actor?.uuid ?? tokenUuid;
  if ( shifting.has(key) ) return false;
  shifting.add(key);
  return enqueue(QUEUE, async () => {
    try {
      if ( !formRevertOf(document) ) return false;
      const done = await revertToOrigin(document);
      if ( !done ) return false;
      log(`shape change ends (${reason}): ${done.from} → ${done.to}`);
      notice(document, { key: "FormeRetour.Avis", data: { name: done.to } }, "info", { all: true, action: "formRevert", outcome: "success" });
      return true;
    } finally { shifting.delete(key); }
  });
}

/** §498: "revert form" intent (right-click menu on one's own token) — by the active GM. */
export function revertShape(token) {
  const document = token?.document ?? token;
  return viaActiveGM(REVERT_FORM_QUERY, handleRevertShape, { token: document?.uuid, reason: "asked" },
    { timeout: 20000, noGm: "FormeRetour.SansMJ", fallback: false, label: "shape change: return" });
}

/** §498: world time has advanced (a combat round, time passing) — the limited forms that reached their end. */
async function onWorldTime(worldTime) {
  for ( const document of expiredFormTokens(worldTime) ) {
    const snap = formRevertOf(document);
    if ( snap.auto !== false ) { await handleRevertShape({ token: document.uuid, reason: "duration elapsed" }); continue; }
    // `auto: false`: the GM decides — a reminder, once; the "Revert form" menu entry remains.
    await markReminded(document);
    await say({ token: document }, locEsc("FormeRetour.Rappel", { name: document.name, item: snap.item ?? "" }),
      { formRevertDue: { token: document.uuid } }, { whisper: game.users.filter(u => u.isGM).map(u => u.id) });
  }
}

export function registerCoven() {
  route("dnd5e.postUseActivity", onFormChange, { executor: true, label: "shape change not played" });
  route("updateWorldTime", onWorldTime, { executor: true, label: "shape change: return at end of duration not played" });
  CONFIG.queries[REVERT_FORM_QUERY] = handleRevertShape;
  route("dnd5e.postUseActivity", onLastStandUsed, { executor: true, label: "last stand: effects not removed" });
  route("dnd5e.damageActor", onHpChanged, { executor: true, label: "coven: HP not shared" });
  route("dnd5e.healActor", onHpChanged, { executor: true, label: "coven: healing not shared" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, "system.attributes.hp.value") === 0 ) return onZero(actor);
  }, { executor: true, label: "second phase not played" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, "delta.system.attributes.hp.value") === 0 ) return onZero(token.actor);
  }, { executor: true, label: "second phase not played (unlinked token)" });
}
