/**
 * Hide (SPEC §15.2, §185), on the client of the one who hides. A single "hidden" state (user decision,
 * 2026-10-14: the action and stealth mode are now one) — the Hide effect, invisible to enemies only (adapter/stealth.mjs):
 *  - `2024` rules: Stealth check DC 15; on a success, the effect carries the total (the DC to locate you); on a failure, out of
 *    combat, you can only retry after 10 s (against spam; in combat, the Action is the cost);
 *  - `bg3` rules: no roll; the effect carries passive Stealth (for Search); each enemy must then spot the creature
 *    (runtime/stealth.mjs).
 * In both: you must be out of every enemy's field of view (cones included out of combat; legality checks it for the item,
 * `hideToken` for the shortcut); Hide ends after an attack roll, or a spell with a verbal component.
 * Being located or making noise is left to the GM: they remove the effect (or passive Perception, Search, BG3 detection).
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOfActivity } from "../adapter/basics.mjs";
import { hiddenEffectsOf, hiddenEffectData, enemiesSeeing } from "../adapter/hide.mjs";
import { stealthRules } from "../adapter/stealth.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, rolledAndShown } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { contentOf } from "../adapter/content.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { coverFor } from "../adapter/cover.mjs";
import { enqueue } from "./queue.mjs";
import { STEPS } from "../core/action.mjs";

/** DC of the Stealth check (2024 rule). */
const HIDE_DC = 15;
/** Out of combat, after a failure (2024 rules): wait before retrying. */
const RETRY_MS = 10000;

const fighting = doc => !!game.combats?.some(c => c.started && c.combatants.some(cb => cb.tokenId === doc?.id));
const tokensOf = actor => actor?.getActiveTokens?.(false, true) ?? [];

/** Clear who had spotted these tokens (BG3 rules). */
async function forgetSpotters(actor) {
  for ( const t of tokensOf(actor) ) if ( t.isOwner && t.getFlag(MODULE_ID, "stealth") ) await t.unsetFlag(MODULE_ID, "stealth");
}

/** §435: the hide end in progress per creature (uuid → promise) — the outcome of an "Ambush Shooter" shot waits for it. */
const endings = new Map();

export function endHiding(actor, why) {
  const key = actor?.uuid;
  const run = (endings.get(key) ?? Promise.resolve()).catch(() => {}).then(() => endHidingNow(actor, why));
  if ( key ) {
    endings.set(key, run);
    run.catch(() => {}).finally(() => { if ( endings.get(key) === run ) endings.delete(key); });
  }
  return run;
}

async function endHidingNow(actor, why) {
  const effects = hiddenEffectsOf(actor);
  if ( !effects.length || !actor.isOwner ) return;
  // §236: Supreme Sneak — the condition removed by an attack roll is kept, so that Sneak Attack can restore it (runtime/sneak.mjs).
  if ( (why === "attack roll") && (hasStealthAttack(actor) || hasSniper(actor)) ) {
    await actor.setFlag(MODULE_ID, "hiddenBeforeAttack", effects.map(e => { const { _id, ...data } = e.toObject(); return data; }));
  }
  await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
  await forgetSpotters(actor);
  log(`hide: ${actor.name} is no longer hidden (${why})`);
  ui.notifications.info(loc("Furtivite.Fin", { name: actor.name }));
  // §183: on the client that changes a creature's hidden state: `(token, hidden)` — its first token (TokenDocument, or null) and
  // the new state. Read-only.
  Hooks.callAll(`${MODULE_ID}.sneak`, tokensOf(actor)[0] ?? null, false);
}

/** §236: does the creature know Sneak Attack (a Cunning Strike `keepsHidden`)? */
const hasStealthAttack = actor => actor.items.some(i => Object.values(contentOf(i).entry?.cunningStrikes ?? {}).some(s => s.keepsHidden));

/** C12-i: Skulker, "Ambush Shooter" — "if you are hidden and miss with an attack roll, the attack doesn't reveal you" (`sniper`) */
const hasSniper = actor => actor.items.some(i => contentOf(i).entry?.sniper === true);

/**
 * §236: restores the hidden state that an attack roll removed (Sneak Attack); end of turn will judge the cover. Returns true if
 * restored.
 * C12-i: `plain` — restored as is, without end-of-turn cover judgment ("Ambush Shooter": the shot missed).
 */
export async function restoreHiding(actor, { plain=false }={}) {
  const kept = actor.getFlag(MODULE_ID, "hiddenBeforeAttack");
  if ( !Array.isArray(kept) || !kept.length ) return false;
  await actor.unsetFlag(MODULE_ID, "hiddenBeforeAttack");
  await actor.createEmbeddedDocuments("ActiveEffect", plain ? kept : kept.map(e => foundry.utils.mergeObject(e, { [`flags.${MODULE_ID}.stealthAttack`]: true })));
  Hooks.callAll(`${MODULE_ID}.sneak`, tokensOf(actor)[0] ?? null, true);
  return true;
}

/**
 * §236: at the end of the turn of a creature kept hidden by Sneak Attack, it needs Three-Quarters Cover or Total Cover against each
 * enemy that would normally see it (alive, on the scene); otherwise the condition ends. Active GM.
 */
async function stealthAttackCheck(combat, prior) {
  const token = combat.combatants.get(prior?.combatantId)?.token;
  const actor = token?.actor;
  const effects = actor ? hiddenEffectsOf(actor).filter(e => e.getFlag(MODULE_ID, "stealthAttack")) : [];
  if ( !effects.length ) return;
  const exposed = token.parent.tokens.filter(t => (t !== token) && t.actor && areEnemies(t, token) && ((t.actor.system.attributes?.hp?.value ?? 0) > 0))
    .filter(t => !["threeQuarters", "total"].includes(coverFor(t, token, { quiet: true })?.degree));
  if ( exposed.length ) await endHiding(actor, `Stealth Attack: not behind cover from ${exposed.map(t => t.name).join(", ")}`);
  else {
    await actor.updateEmbeddedDocuments("ActiveEffect", effects.map(e => ({ _id: e.id, [`flags.${MODULE_ID}.stealthAttack`]: new foundry.data.operators.ForcedDeletion() })));
    log(`hide: ${actor.name} stays hidden (Stealth Attack, behind cover)`);
  }
}

/** The flag of an attack roll without Sneak Attack is no longer needed: removed on the next turn. */
async function forgetKeptHiding(combat, prior) {
  const actor = combat.combatants.get(prior?.combatantId)?.actor;
  if ( actor?.getFlag(MODULE_ID, "hiddenBeforeAttack") ) await actor.unsetFlag(MODULE_ID, "hiddenBeforeAttack");
}

/**
 * Hiding, per the world's rules (the action is already paid, or out of combat). Returns `{ hidden, total?, reason? }`.
 * @param {Actor} actor
 * @param {TokenDocument|null} token
 */
export async function attemptHide(actor, token=null) {
  const rules = stealthRules();
  const t = token ?? tokensOf(actor)[0] ?? null;
  // Issue #65: Hide not handled — the action is taken, the GM judges; a notice to all, no roll, no effect.
  if ( rules === "off" ) {
    log(`hide: ${actor.name} hides (stealth rules off: the GM decides)`);
    if ( t ) notice(t, { key: "Retour.Action.CacheMJ" }, "gain", { all: true, action: "hide" });
    ui.notifications.info(loc("Furtivite.MJ", { name: actor.name }));
    return { hidden: false, reason: "off" };
  }
  if ( (rules === "2024") && t && !fighting(t) ) {
    const retry = Number(t.getFlag(MODULE_ID, "hideRetryAt")) || 0;
    if ( Date.now() < retry ) {
      ui.notifications.info(loc("Furtivite.Attendre", { name: actor.name, s: Math.ceil((retry - Date.now()) / 1000) }));
      return { hidden: false, reason: "cooldown" };
    }
  }
  let dc;
  if ( rules === "bg3" ) dc = Number(actor.system?.skills?.ste?.passive) || (10 + (Number(actor.system?.skills?.ste?.total) || 0));
  else {
    // §252: the verdict waits for the 3D dice to finish, then is seen and heard by all.
    const rolls = await rolledAndShown(() => actor.rollSkill({ skill: "ste", target: HIDE_DC }, { configure: false }));
    const total = rolls?.[0]?.total;
    if ( !Number.isFinite(total) ) return { hidden: false, reason: "noRoll" };
    if ( total < HIDE_DC ) {
      log(`hide: ${actor.name} fails (${total} vs DC ${HIDE_DC})`);
      if ( t ) notice(t, { key: "Retour.Action.PasCache" }, "refused", { all: true, action: "hide", outcome: "failure" });
      if ( t?.isOwner && !fighting(t) ) await t.setFlag(MODULE_ID, "hideRetryAt", Date.now() + RETRY_MS);
      ui.notifications.info(loc("Furtivite.Rate", { name: actor.name, total }));
      return { hidden: false, total, reason: "failed" };
    }
    dc = total;
  }
  await actor.deleteEmbeddedDocuments("ActiveEffect", hiddenEffectsOf(actor).map(e => e.id));
  await forgetSpotters(actor);
  await actor.createEmbeddedDocuments("ActiveEffect", [hiddenEffectData(dc, loc("Furtivite.Effet", { dc }))]);
  log(`hide: ${actor.name} is hidden (${rules}, DC ${dc} to find them)`);
  ui.notifications.info(loc(rules === "bg3" ? "Furtivite.ReussieBG3" : "Furtivite.Reussie", { name: actor.name, total: dc }));
  if ( t ) notice(t, { key: "Retour.Action.Cache" }, "gain", { all: true, action: "hide", outcome: "success" });
  Hooks.callAll(`${MODULE_ID}.sneak`, t, true);
  return { hidden: true, total: dc };
}

/**
 * The shortcut and the button (§183): hidden → no longer so; otherwise hide. Out of combat, free, if no enemy sees them.
 * In combat, the Hide action is taken through its item (legality and budget): returns `reason: "inCombat"`.
 */
export async function toggleHidden(token) {
  const doc = token?.document ?? token;
  const actor = doc?.actor;
  if ( !actor || !doc.isOwner ) return { hidden: false, reason: "notOwner" };
  if ( hiddenEffectsOf(actor).length ) { await endHiding(actor, "by hand"); return { hidden: false }; }
  if ( fighting(doc) ) return { hidden: false, reason: "inCombat" };
  if ( stealthRules() === "off" ) return attemptHide(actor, doc);
  const seen = enemiesSeeing(doc) ?? [];
  if ( seen.length ) {
    ui.notifications.info(loc("Furtivite.Vu", { name: actor.name, by: seen.map(s => s.name).join(", ") }));
    return { hidden: false, reason: "seen" };
  }
  return attemptHide(actor, doc);
}

async function onPostUse(activity, usageConfig) {
  const actor = activity.actor;
  if ( !actor ) return;
  // The Hide item, or an activity that takes the Hide action (Rogue's Cunning Action, as a Bonus Action: §20).
  if ( basicActionOfActivity(activity, usageConfig?.[MODULE_ID]?.basicChoice) === "hide" ) return attemptHide(actor);
  // A spell with a verbal component gives the hiding place away.
  if ( isSpellCast(activity.item) && activity.item.system.properties?.has("vocal") ) await endHiding(actor, "spell with a Verbal component");
}

/** C12-i: active GM — an "Ambush Shooter" attack decided: missed (all targets), they stay hidden; hit, the kept hiding is forgotten. */
async function sniperOutcome(resolution) {
  if ( !resolution?.plan?.attack || ![STEPS.DONE, STEPS.MISSED].includes(resolution.step) ) return;
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const actor = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  if ( !actor || !hasSniper(actor) ) return;
  // §435: a missed shot is decided before dnd5e even calls `dnd5e.rollAttackV2` (seen on the bench: outcome "missed" published,
  // the hidden state still there, no flag) — the roll's hide end has not started. Wait for it (3 s at most), otherwise the
  // "Ambush Shooter" lost their hiding on a miss.
  for ( const stop = Date.now() + 3000; !endings.has(actor.uuid) && !actor.getFlag(MODULE_ID, "hiddenBeforeAttack")
    && hiddenEffectsOf(actor).length && (Date.now() < stop); ) await new Promise(r => setTimeout(r, 100));
  await endings.get(actor.uuid)?.catch(() => {});
  if ( !actor.getFlag(MODULE_ID, "hiddenBeforeAttack") ) return;
  const missed = (resolution.targets ?? []).every(t => !t.hit);
  if ( missed && await restoreHiding(actor, { plain: true }) ) { log(`hide: ${actor.name} missed from hiding — still hidden (Skulker)`); return; }
  // Hit: Sneak Attack (Rogue) can still restore it; otherwise, the kept hiding is no longer needed.
  if ( !hasStealthAttack(actor) ) await actor.unsetFlag(MODULE_ID, "hiddenBeforeAttack");
}

export function registerHide() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`sniper:${resolution?.id}`, () => sniperOutcome(resolution)), { executor: true, label: "Skulker: hiding not kept" });
  route("dnd5e.postUseActivity", (activity, usageConfig) => { onPostUse(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | hide`, err)); },
    { label: "hide" });
  // "You stop being hidden immediately after… an attack roll": after the roll, which benefited from invisibility.
  route("dnd5e.rollAttackV2", (rolls, { subject }={}) => {
    const actor = subject?.actor;
    if ( actor ) endHiding(actor, "attack roll").catch(err => console.error(`${MODULE_ID} | hide`, err));
  }, { label: "hide: ends on attack roll" });
  route("combatTurnChange", (combat, prior) => enqueue(`stealthAttack:${prior?.combatantId}`, async () => { await stealthAttackCheck(combat, prior); await forgetKeptHiding(combat, prior); }),
    { executor: true, label: "Stealth Attack: cover not judged" });
}
