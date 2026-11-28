/**
 * §16.47: a spell that ends a condition (`cures`: Lesser Restoration — "one condition among Blinded, Deafened,
 * Paralyzed or Poisoned"). The interface picks the condition (ui/cure.mjs); the effects carrying it are removed — by the active
 * GM when the target does not belong to the author.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { splitPool } from "../core/pools.mjs";
import { askAllocation } from "../adapter/projectiles.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { budgetIssues, spendBudget } from "./neighbours.mjs";
import { log, loc, notice, viaOwnerOrGM } from "./shared.mjs";
import { needsCheck, cureAllowed, healedHp, grantedTempHp } from "../core/requests.mjs";

export const CURE_QUERY = `${MODULE_ID}.cure`;

async function removeStatus(targetUuid, status) {
  const token = await fromUuid(targetUuid);
  const actor = token?.actor;
  if ( !actor ) return 0;
  const ids = actor.effects.filter(e => e.statuses?.has(status)).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

/**
 * §471: a request from a client other than a GM is valid only with proof — the use card (`usage`) it created
 * for a creature it controls, whose item carries this act's rule and which targets this target (or its own caster) — and within
 * bounds: a heal does not hurt and does not exceed the maximum, Temporary Hit Points no more than the pool or the card's roll.
 * Returns the data to apply, or null (security refusal: not forceable).
 * @returns {Promise<object|null>}
 */
async function vetCure({ target, status, value=null, usage=null }, user) {
  const card = game.messages.get(String(usage ?? ""));
  const caster = card?.getAssociatedActor?.() ?? null;
  const item = card?.getAssociatedItem?.() ?? null;
  const sent = !!card && ((card.author?.id === user.id) || !!caster?.testUserPermission(user, "OWNER"));
  const aimed = (card?.system?.targets ?? []).some(t => t.token === target)
    || (!!caster && ((await fromUuid(target))?.actor?.uuid === caster.uuid));
  const entry = item ? contentOf(item).entry : null;
  if ( !sent || !aimed || !cureAllowed(entry, status, value) ) return null;
  if ( status === "hp" ) {
    const hp = (await fromUuid(target))?.actor?.system?.attributes?.hp ?? {};
    return { target, status, value: healedHp(value, { current: Number(hp.value) || 0, max: Number(hp.effectiveMax ?? hp.max) || 0 }) };
  }
  if ( status === "temphp" ) {
    const rolled = game.messages.contents.filter(m => ["healing", "damage"].includes(m.type) && (m._source.system?.origin === card.id))
      .flatMap(m => m.rolls ?? []).reduce((sum, r) => sum + (r.total ?? 0), 0);
    const ceiling = entry.tempHpPool || rolled || Infinity;
    return { target, status, value: grantedTempHp(value, ceiling) };
  }
  return { target, status, value };
}

async function handleCure(payload, { user=null }={}) {
  if ( needsCheck(user) ) {
    const vetted = await vetCure(payload ?? {}, user);
    if ( !vetted ) {
      console.warn(`${MODULE_ID} | cure query from ${user.name} refused: ${payload?.status} on ${payload?.target} without a usage card that allows it`);
      return 0;
    }
    payload = vetted;
  }
  const { target, status, value=null } = payload;
  // §160: "reduces the Exhaustion level by one" (Greater Restoration).
  if ( status === "exhaustion-1" ) {
    const actor = (await fromUuid(target))?.actor;
    const level = Number(actor?.system?.attributes?.exhaustion) || 0;
    if ( actor && level ) await actor.update({ "system.attributes.exhaustion": level - 1 });
    return level ? 1 : 0;
  }
  // §160: the acts on the target that require the GM (another's target) — HP, Temporary Hit Points, curses.
  if ( status === "hp" ) { const actor = (await fromUuid(target))?.actor; if ( actor ) await actor.update({ "system.attributes.hp.value": value }); return 1; }
  if ( status === "temphp" ) {
    const actor = (await fromUuid(target))?.actor;
    if ( actor && (value > (Number(actor.system.attributes.hp.temp) || 0)) ) await actor.update({ "system.attributes.hp.temp": value });
    return 1;
  }
  if ( status === "curses" ) {
    const actor = (await fromUuid(target))?.actor;
    const ids = (actor?.effects ?? []).filter(e => value.includes(identifierOf(originItemOf(e) ?? {}).id)).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    return ids.length;
  }
  if ( status === "exhaustion" ) {
    const actor = (await fromUuid(target))?.actor;
    if ( actor ) await actor.update({ "system.attributes.exhaustion": 0 });
    return actor ? 1 : 0;
  }
  if ( status === "standReaction" ) return standWithReaction(target, value);
  return removeStatus(target, status);
}

/**
 * §401: Power Word Heal — "if the creature is Prone, it can use its Reaction to stand up". On the active GM:
 * the question goes to the target's player (otherwise the GM); if yes, Prone is removed and the Reaction is spent (in combat).
 * Returns 1 if it stands up.
 */
async function standWithReaction(targetUuid, item) {
  const token = await fromUuid(targetUuid);
  const actor = token?.actor;
  if ( !actor?.statuses?.has("prone") ) return 0;
  if ( budgetIssues(actor, "reaction").includes("noReaction") ) { log(`${item}: ${actor.name} is Prone but has no Reaction left`); return 0; }
  const answer = await askChoice(actor, { actor: actor.uuid, item, prompt: loc("SeRelever.Question"), options: [
    { id: "stand", label: loc("SeRelever.Oui"), icon: "fa-solid fa-person-arrow-up-from-line" },
    { id: "stay", label: loc("SeRelever.Non"), icon: "fa-solid fa-xmark" }] });
  if ( answer?.id !== "stand" ) { log(`${item}: ${actor.name} stays Prone`); return 0; }
  await removeStatus(targetUuid, "prone");
  await spendBudget(actor, "reaction");
  notice(token, loc("SeRelever.Fait"), "reaction");
  log(`${item}: ${actor.name} stands up with their Reaction`);
  return 1;
}

/** An act on the target: here if we own it, otherwise by the active GM. */
const onTarget = (target, status, value=null, usage=null) =>
  viaOwnerOrGM(!!target.actor?.isOwner, CURE_QUERY, handleCure, { target: target.uuid, status, value, usage }, { fallback: 0 });

/** Ends `status` on the token `target` (TokenDocument). Exhaustion: one level less (§160, Greater Restoration). */
export async function cureStatus(target, status, { usage=null }={}) {
  // Without an active GM for another's target, the request returns nothing: nothing ended. `usage`: the use card, the GM's proof.
  const n = Number(await onTarget(target, (status === "exhaustion") ? "exhaustion-1" : status, null, usage)) || 0;
  const label = game.i18n.localize(CONFIG.DND5E.conditionTypes[status]?.name ?? status);
  log(`${target.name}: ${label} ends (${n} effect(s))`);
  if ( n > 0 ) notice(target, label, "effectOff");
  return n;
}

/**
 * §296: the activity's pool (the heal roll dnd5e has just made — its `healing` message, otherwise the formula) split among the
 * chosen creatures: as HP (`hp`), capped at half the maximum HP (`cap: "halfMax"`: "Survivance") or at the maximum,
 * or as Temporary Hit Points (`temp`: "Exalting Smite"). The dnd5e roll is not applied as is
 * (adapter/usage.mjs, plan without heal).
 */
async function sharePool(activity, pool, targets, results) {
  const usage = results?.message?.id ?? null;
  let total = 0;
  for ( let waited = 0; usage && !total && (waited < 4000); waited += 200 ) {
    const roll = game.messages.contents.findLast(m => (m.type === "healing") && (m._source.system?.origin === usage));
    total = (roll?.rolls ?? []).reduce((sum, r) => sum + (r.total ?? 0), 0);
    if ( !total ) await new Promise(resolve => setTimeout(resolve, 200));
  }
  if ( !total ) {
    const formula = pool.formula ?? activity.healing?.formula ?? "0";
    total = (await new Roll(formula, activity.getRollData?.() ?? {}).evaluate()).total ?? 0;
  }
  const caps = targets.map(t => {
    if ( pool.temp ) return Infinity;
    const hp = t.actor.system.attributes?.hp ?? {};
    const max = hp.effectiveMax ?? hp.max ?? 0;
    const ceiling = (pool.cap === "halfMax") ? Math.floor(max / 2) : max;
    return Math.max(0, ceiling - (hp.value ?? 0));
  });
  let shares = splitPool(total, caps.map(c => (Number.isFinite(c) ? c : total)));
  // §401: "divided as you wish" (`choose`) — the author adjusts the split, caps respected.
  if ( pool.choose && (targets.length > 1) ) shares = await chosenShares(activity, total, targets, shares, caps);
  for ( const [i, target] of targets.entries() ) {
    if ( !shares[i] ) continue;
    if ( pool.temp ) await onTarget(target, "temphp", shares[i], usage);
    else await onTarget(target, "hp", (target.actor.system.attributes.hp.value ?? 0) + shares[i], usage);
  }
  const detail = targets.map((t, i) => `${t.name} ${shares[i]}`).join(", ");
  log(`${activity.item.name}: pool of ${total} — ${detail}`);
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: activity.actor }),
    content: `<p>${foundry.utils.escapeHTML(loc("Choisir.Reserve", { item: activity.item.name, total, detail }))}</p>` });
}

/**
 * §401: the split of a pool asked of the author (their player, otherwise the GM), prefilled with `shares`. Returns the shares,
 * each capped (`caps`) and their sum at most `total`; with no answer, `shares`.
 */
async function chosenShares(activity, total, targets, shares, caps) {
  const actor = activity.actor;
  const defaults = Object.fromEntries(targets.map((t, i) => [t.uuid, shares[i]]));
  const answer = await askAllocation(actor, { item: activity.item.name, count: total, defaults,
    text: loc("Choisir.Repartir", { total }), title: loc("Choisir.RepartirTitre", { item: activity.item.name }), targets: targets.map(t => ({ token: t.uuid, name: t.name })) });
  if ( !answer?.counts ) return shares;
  let left = total;
  return targets.map((t, i) => {
    const wanted = Math.max(0, Math.floor(Number(answer.counts[t.uuid]) || 0));
    const given = Math.min(wanted, Number.isFinite(caps[i]) ? caps[i] : wanted, left);
    left -= given;
    return given;
  });
}

/**
 * §53: `curesAll` — all the listed conditions end on the target (Elixir of Health: Blinded, Deafened, Paralyzed, Poisoned;
 * Potion of Vitality: Exhaustion and Poisoned). The target: the first one of the message, otherwise the user (a potion drunk).
 */
async function onPostUseAll(activity, usageConfig, results) {
  const entry = contentOf(activity?.item).entry;
  if ( !activity?.actor?.isOwner || !entry ) return;
  const usage = results?.message?.id ?? null;
  // §160: all the message's targets ("Group Healing"), otherwise the user (a potion drunk).
  const listed = await Promise.all((results?.message?.system?.targets ?? []).map(t => fromUuid(t.token)));
  const targets = listed.filter(t => t?.actor);
  if ( !targets.length && usageTokenOf(activity)?.actor ) targets.push(usageTokenOf(activity));
  // §160: Remove Curse — the effects of curse spells end.
  if ( entry.endsCurses?.length ) for ( const target of targets ) {
    const n = await onTarget(target, "curses", entry.endsCurses, usage);
    log(`${activity.item.name}: ${n} curse effect(s) end on ${target.name}`);
  }
  // §296: a pool to split (`healPool`: "Survivance", "Group Healing", "Mechanical Cavalcade", "Exalting Smite").
  const pool = entry.healPool;
  if ( pool?.activities?.includes(activity.id) && targets.length ) await sharePool(activity, pool, targets, results);
  // §160: Power Word Fortify — "120 Temporary Hit Points divided equally among the chosen creatures".
  // §401: "that you divide" — equal shares proposed, the author adjusts them.
  if ( entry.tempHpPool && targets.length ) {
    const total = entry.tempHpPool;
    let shares = targets.map(() => Math.floor(total / targets.length));
    if ( targets.length > 1 ) shares = await chosenShares(activity, total, targets, shares, targets.map(() => Infinity));
    for ( const [i, target] of targets.entries() ) if ( shares[i] ) await onTarget(target, "temphp", shares[i], usage);
    log(`${activity.item.name}: temporary HP — ${targets.map((t, i) => `${t.name} ${shares[i]}`).join(", ")}`);
  }
  // §401: standing up with one's Reaction (Power Word Heal) — always by the active GM (the budget is a combatant flag).
  if ( entry.standsWithReaction ) for ( const target of targets ) {
    if ( target.actor.statuses?.has("prone") ) await viaOwnerOrGM(game.users.activeGM?.isSelf === true, CURE_QUERY, handleCure,
      { target: target.uuid, status: "standReaction", value: activity.item.name, usage }, { fallback: 0, timeout: 45000 });
  }
  // §160: Resurrection — "returns to life with all its HP".
  if ( entry.revivesFull ) for ( const target of targets ) {
    const hp = target.actor.system.attributes.hp;
    await onTarget(target, "hp", hp.effectiveMax ?? hp.max, usage);
    log(`${activity.item.name}: ${target.name} back to ${hp.effectiveMax ?? hp.max} HP`);
  }
  const list = entry.curesAll;
  if ( !list?.length ) return;
  for ( const target of targets ) for ( const status of list ) {
    if ( status === "exhaustion" ) {
      const level = target.actor.system?.attributes?.exhaustion ?? 0;
      if ( level > 0 ) {
        await onTarget(target, "exhaustion", null, usage);
        log(`${target.name}: Exhaustion ${level} → 0`);
      }
      continue;
    }
    if ( target.actor.statuses?.has(status) ) await cureStatus(target, status, { usage });
  }
}

/**
 * K12 (§333): an item effect that carries the condition "exhaustion" ("Warping Hex", "Weight of Years", "Drinking Wisdom")
 * does not raise the Exhaustion level in dnd5e 6 — only its own effect (`dnd5eexhaustion0`)
 * follows `system.attributes.exhaustion`. The active GM raises the level by one step (6 at most)
 * and removes the item's effect, or only its condition if it carries other changes or conditions.
 */
async function onExhaustionEffect(effect) {
  const actor = effect.parent;
  if ( !(actor instanceof Actor) || (effect.id === "dnd5eexhaustion0") || !effect.statuses?.has("exhaustion") ) return;
  const level = Number(actor.system?.attributes?.exhaustion) || 0;
  if ( effect.changes?.length || (effect.statuses.size > 1) ) await effect.update({ statuses: [...effect.statuses].filter(s => s !== "exhaustion") });
  else await effect.delete();
  await actor.update({ "system.attributes.exhaustion": Math.min(6, level + 1) });
  log(`${actor.name}: ${effect.name} — Exhaustion ${level} → ${Math.min(6, level + 1)}`);
}

export function registerCure() {
  CONFIG.queries[CURE_QUERY] = handleCure;
  route("dnd5e.postUseActivity", onPostUseAll, { label: "potion: conditions not removed" });
  route("createActiveEffect", onExhaustionEffect, { executor: true, label: "Exhaustion: level not raised by an item effect" });
}
