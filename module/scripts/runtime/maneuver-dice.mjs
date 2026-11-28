/**
 * §89: maneuver dice played as a Bonus Action (Battle Master).
 *
 *  - `pendingDie` `{ activity, against }`: using the activity PROMISES its die (the first damage part, read with the actor's data:
 *    "1d8") to the next damage roll of an attack by the author, in this turn — in melee (`"melee"`, Lunging Attack: "if you hit
 *    with a melee attack this turn") or against the creature designated at use (`"target"`, Feinting Attack: "if this attack
 *    hits"). Promise carried by the actor (`flags.dnd5e-combat.pendingDie`); added to the damage roll on the author's client
 *    (`dnd5e.preRollDamageV2`, of the type of the first roll), then cleared. Against a target: a missed attack against them also
 *    clears it ("your next attack roll") — on the active GM, at resolution. Outside the turn where it was born: nothing.
 *  - `rolledAc` `{ activity, effect }`: using the activity rolls the die of its `roll` (Evasive Footwork: "roll the die and add
 *    it to your AC until the start of your next turn") and places the item's effect on the author, the AC bonus written in it
 *    (the data's effect is empty).
 * The die itself is paid by the activity's consumption (a superiority die), as dnd5e does.
 *
 * §90, on the active GM (it moves and writes for creatures other than the author):
 *  - `sweep` (Sweeping Attack): after a melee hit (weapon, unarmed), the author can deal the activity's die, of the type of the
 *    hit's damage, to another creature within 1.50 m of the hit target and within reach, that the roll would have hit; the
 *    activity pays without being used (its damage card would hit its own target).
 *  - `swapPlaces` ("Criss-Cross"): the author and the target creature, 1.50 m apart, swap places — it by a teleportation,
 *    the author by a step (1.50 m of their movement), both without Opportunity Attack; `rolledAc.to: "choose"`: the die to the AC
 *    of one or the other, at the author's choice.
 *  - `commandStrike` (Commander's Strike): the target creature receives the order (`commanded` in its turn budget: its next
 *    weapon attack this turn is paid with its Reaction, runtime/turn.mjs) and the die promised to its damage (`pendingDie`,
 *    `against: "any"`).
 *
 * §279, maximum damage:
 *  - `maxDamage` `{ activity, weapons?, refundOnHit? }`: using the activity promises the maximum of the dice to the author's next
 *    attack this turn with a weapon of these kinds (`weapons`: "unarmed" or a dnd5e weapon type, adapter/messages.mjs
 *    `weaponKind`) — the promise is carried like `pendingDie` (`flags.dnd5e-combat.maxDamage`); if it hits, the damage roll's dice
 *    are at their maximum and, with `refundOnHit`, the uses that the activity cost come back; if it misses, it is lost (on the
 *    active GM, at resolution).
 *  - `maxNextHit: true`: a creature carrying an effect of the item takes the maximum of the dice of the next attack that hits it,
 *    then the effect ends (on the active GM, at resolution).
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { maximizeDice } from "../core/max-dice.mjs";
import { weaponKind } from "../adapter/messages.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { currentTurnKey, combatantFor, readBudget, writeBudget, distanceBetween, historyCosts, speakerTokenOf } from "../adapter/turn.mjs";
import { placeItemEffect, placeRemoteEffect } from "../adapter/effects.mjs";
import { usesLeftFor } from "../adapter/inspiration.mjs";
import { payWithoutUse } from "../adapter/reactions.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { movementCap } from "./actions.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, sleep, say, locEsc } from "./shared.mjs";

const FLAG = "pendingDie";
const MAX_FLAG = "maxDamage";

/**
 * The AC bonus of a rolled die (`rolledAc`) placed on `recipient`. The item's template effect (Player's Handbook 2.2.0, empty in
 * the data) receives the total. §438: Player's Handbook 3.0.0 no longer has an effect on the item; the activity points to twelve
 * "AC +N" effects of its compendium — the one whose bonus equals the total is placed. None fits: nothing (the player keeps the
 * card's buttons).
 */
async function placeAcBonus(activity, rule, recipient, total, name=null) {
  const own = await placeItemEffect(activity.item, rule.effect, recipient);
  if ( own ) {
    await own.update({ ...(name ? { name } : {}), "system.changes": [{ key: "system.attributes.ac.bonus", type: "add", value: String(total) }] });
    return own;
  }
  for ( const ref of activity.effects ?? [] ) {
    if ( !ref?.uuid ) continue;
    const source = await fromUuid(ref.uuid).catch(() => null);
    const changes = source?.system?.changes ?? source?.changes ?? [];
    if ( !changes.some(c => (c.key === "system.attributes.ac.bonus") && (Number(c.value) === total)) ) continue;
    return placeRemoteEffect(activity.item, ref.uuid, recipient);
  }
  return null;
}

/** The formula of the first damage part of the activity, read with the actor's data. */
function dieOf(activity) {
  const part = activity?.damage?.parts?.[0];
  const raw = part?.custom?.enabled ? part.custom.formula : ((part?.number && part?.denomination) ? `${part.number}d${part.denomination}` : null);
  return raw ? Roll.replaceFormulaData(raw, activity.getRollData?.() ?? {}) : null;
}

async function onPostUse(activity, usageConfig, results) {
  const entry = activity?.item ? contentOf(activity.item).entry : null;
  const actor = activity?.actor;
  if ( !entry || !actor || !results ) return;
  const pending = (entry.pendingDie?.activity === activity.id) ? entry.pendingDie : null;
  if ( pending ) {
    const formula = dieOf(activity);
    const target = (pending.against === "target") ? (results.message?.system?.targets?.[0]?.token ?? Array.from(game.user.targets)[0]?.document?.uuid ?? null) : null;
    if ( formula ) {
      await actor.setFlag(MODULE_ID, FLAG, { item: activity.item.uuid, name: activity.item.name, formula, against: pending.against, target, turn: currentTurnKey() });
      log(`${activity.item.name}: +${formula} promised to the next hit ${pending.against === "target" ? "against the target" : "in melee"} this turn`);
    }
  }
  // §279: the maximum promise ("Club Blow"), with what the activity cost, to give it back on a hit.
  if ( entry.maxDamage?.activity === activity.id ) {
    const refund = (activity.consumption?.targets ?? []).filter(t => t.type === "itemUses")
      .map(t => ({ item: t.target || activity.item.id, value: Number(t.value) || 1 }));
    await actor.setFlag(MODULE_ID, MAX_FLAG, { item: activity.item.uuid, name: activity.item.name, weapons: entry.maxDamage.weapons ?? null,
      refund: entry.maxDamage.refundOnHit ? refund : [], turn: currentTurnKey() });
    log(`${activity.item.name}: maximum damage promised to the next qualifying attack this turn`);
  }
  const rolled = ((entry.rolledAc?.activity === activity.id) && (entry.rolledAc.to !== "choose")) ? entry.rolledAc : null;
  if ( rolled && activity.roll?.formula ) {
    const roll = await new Roll(activity.roll.formula, activity.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${activity.item.name} : ${activity.roll.name || "CA"}` });
    // After the utility resolves, which places the data's (empty) effect: we replace it with ours, the bonus written in it.
    await sleep(1500);
    const effect = await placeAcBonus(activity, rolled, actor, roll.total);
    if ( effect ) log(`${activity.item.name}: +${roll.total} to ${actor.name}'s AC`);
  }
}

/** §279: does the maximum promise apply to this attack (same turn, weapon kind)? */
function maxPromiseFits(promise, activity) {
  if ( !promise || (activity?.type !== "attack") ) return false;
  return !promise.weapons || promise.weapons.includes(weaponKind(activity));
}

/** §279: do the target creatures carry an effect of a `maxNextHit` item? Returns those effects. */
function maxNextHitEffects(actor) {
  return (actor?.appliedEffects ?? []).filter(e => {
    const item = originItemOf(e);
    const rule = item ? contentOf(item).entry?.maxNextHit : null;
    // §372: an effect id — only the copy of THIS item effect (`_stats.duplicateSource`, placed by placeItemEffect).
    return (rule === true) || (!!rule && [e._stats?.duplicateSource, e._stats?.compendiumSource].some(u => String(u ?? "").endsWith(`.ActiveEffect.${rule}`)));
  });
}

/** §279: on the author's client, at the damage roll of a hit — the dice at their maximum ("Club Blow", "Endangering"). */
function maximizeOnHit(config, message) {
  const activity = config?.subject;
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || !config.rolls?.length ) return;
  const promise = actor.getFlag(MODULE_ID, MAX_FLAG);
  if ( promise && (promise.turn !== currentTurnKey()) ) actor.unsetFlag(MODULE_ID, MAX_FLAG).catch(() => {});
  const promised = promise && (promise.turn === currentTurnKey()) && maxPromiseFits(promise, activity);
  const targets = (foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [])
    .map(t => fromUuidSync(t.token, { strict: false })?.actor).filter(Boolean);
  const endangered = targets.length && targets.every(t => maxNextHitEffects(t).length);
  if ( !promised && !endangered ) return;
  for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(part => maximizeDice(part));
  log(`${activity.item?.name}: damage dice at their maximum (${promised ? promise.name : "next hit"})`);
  if ( !promised ) return;
  actor.unsetFlag(MODULE_ID, MAX_FLAG).catch(() => {});
  for ( const { item: id, value } of promise.refund ?? [] ) {
    // A consumption target by identifier (DDB Importer data: "moxie") rather than by id.
    const item = actor.items.get(id) ?? actor.items.find(i => identifierOf(i).id === id);
    const spent = Number(item?.system?.uses?.spent) || 0;
    if ( item && spent ) item.update({ "system.uses.spent": Math.max(0, spent - value) }).catch(() => {});
  }
}

function onPreRollDamage(config, dialog, message) {
  maximizeOnHit(config, message);
  const activity = config?.subject;
  const actor = activity?.actor;
  const pending = actor?.getFlag(MODULE_ID, FLAG);
  if ( !pending || !config.rolls?.length || (activity.type !== "attack") ) return true;
  if ( pending.turn !== currentTurnKey() ) { actor.unsetFlag(MODULE_ID, FLAG).catch(() => {}); return true; }
  if ( (pending.against === "melee") && (activity.attack?.type?.value !== "melee") ) return true;
  // §90: the Commander's Strike order applies to an attack with a weapon or unarmed.
  if ( (pending.against === "any") && !["weapon", "unarmed"].includes(activity.attack?.type?.classification) ) return true;
  if ( pending.against === "target" ) {
    const targets = foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [];
    if ( !targets.some(t => t.token === pending.target) ) return true;
  }
  const type = config.rolls[0]?.options?.type ?? null;
  config.rolls.push({ data: activity.getRollData(), parts: [pending.formula], options: { type, types: type ? [type] : [], properties: [] } });
  actor.unsetFlag(MODULE_ID, FLAG).catch(() => {});
  log(`${pending.name}: +${pending.formula} ${type ?? ""}`);
  return true;
}

/** Feinting: a MISSED attack on the designated target clears the promise ("your next attack roll against it"). §90: Sweeping Attack. */
async function onResolution(resolution) {
  // An attack that misses everyone ends in MISSED, not DONE (core/action.mjs, `afterVerdict`): without this case, the missed
  // Feinting Attack kept its die for the next hit (seen on 2026-10-26, scenario `maitre-de-guerre`).
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) || !resolution.plan?.attack ) return;
  const source = fromUuidSync(resolution.source ?? "", { strict: false });
  const actor = source?.actor ?? source;
  if ( actor?.items ) await sweep(resolution, actor, source?.actor ? source : tokenOf(actor));
  await settleMaxDamage(resolution, actor);
  const pending = actor?.getFlag?.(MODULE_ID, FLAG);
  if ( !pending || (pending.against !== "target") ) return;
  const missed = (resolution.targets ?? []).some(t => (t.token === pending.target) && (t.hit === false));
  if ( missed ) {
    await actor.unsetFlag(MODULE_ID, FLAG);
    log(`${pending.name}: the attack against the target missed, the die is lost`);
  }
}

/* -------------------------------------------- */
/*  §90: Sweeping Attack, "Criss-Cross", Commander's Strike */
/* -------------------------------------------- */

const within = (a, b, value) => distanceBetween(a, b).value <= (value + 1e-6);

/** Sweeping Attack: the melee attack hit; another creature the roll would have hit, within 1.50 m of the target and within reach. */
async function sweep(resolution, actor, attacker) {
  const attack = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( (attack?.type !== "attack") || (attack.attack?.type?.value !== "melee") || !["weapon", "unarmed"].includes(attack.attack?.type?.classification) ) return;
  const hit = (resolution.targets ?? []).find(t => t.hit === true);
  const total = resolution.attack?.roll?.total;
  const first = hit ? fromUuidSync(hit.token ?? "", { strict: false }) : null;
  if ( !first || !attacker || !Number.isFinite(total) ) return;
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.sweep;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    const grid = first.parent.grid;
    const reach = attack.range?.reach ?? attack.item?.system?.range?.reach ?? 5;
    const units = attack.range?.units ?? attack.item?.system?.range?.units ?? "ft";
    const reachValue = (units === grid.units) ? reach : (grid.distance * reach / 5);
    const struck = new Set((resolution.targets ?? []).map(t => t.token));
    const candidates = first.parent.tokens.filter(t => t.actor && (t !== first) && (t !== attacker) && !struck.has(t.uuid)
      && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && within(first, t, grid.distance) && within(attacker, t, reachValue)
      && (total >= (t.actor.system.attributes?.ac?.value ?? Infinity)));
    if ( !candidates.length ) return;
    const formula = dieOf(activity);
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, prompt: loc("Balayage.Question", { item: item.name, formula, name: first.name }),
      options: [{ id: "no", label: loc("Balayage.Non") }, ...candidates.map(t => ({ id: t.uuid, label: t.name }))]
    });
    const victim = candidates.find(t => t.uuid === answer?.id);
    if ( !victim || !formula ) return;
    await payWithoutUse(activity);
    const type = resolution.damageRoll?.damages?.[0]?.type ?? Array.from(attack.item?.system?.damage?.base?.types ?? [])[0] ?? null;
    const roll = await new Roll(formula).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: loc("Balayage.Carte", { item: item.name, name: victim.name, type: CONFIG.DND5E.damageTypes?.[type]?.label ?? type ?? "" }),
      flags: { [MODULE_ID]: { sweep: { item: item.uuid, target: victim.uuid, amount: roll.total, type } } } });
    await victim.actor.applyDamage([{ value: roll.total, type }]);
    log(`${item.name}: ${roll.total} damage (${type}) to ${victim.name}`);
    return;
  }
}

/** "Criss-Cross": the places swapped; true if done. */
async function swapPlaces(item, self, other) {
  const grid = self.parent.grid;
  if ( !other || (other === self) || !within(self, other, grid.distance) ) { notice(self, loc("ChasseCroise.Loin", { item: item.name })); return false; }
  if ( combatantFor(self.actor) ) {
    const { spent, excluded } = historyCosts(self);
    if ( (movementCap(self) - spent - excluded) < (grid.distance - 1e-6) ) { notice(self, loc("ChasseCroise.Mouvement", { item: item.name })); return false; }
  }
  const at = t => { const p = t._source; return { x: p.x, y: p.y, elevation: p.elevation ?? 0, level: p.level ?? null }; };
  const from = at(self), to = at(other);
  const options = { constrainOptions: { ignoreWalls: true, ignoreTokens: true }, [MODULE_ID]: { cleared: true } };
  await other.move([{ ...from, snapped: true, action: "blink" }], options);
  await self.move([{ ...to, snapped: true }], options);
  log(`${item.name}: ${self.name} and ${other.name} swap places`);
  return true;
}

/** "Criss-Cross": the activity's die, added to the AC of the author or of the other. */
async function chosenAc(activity, rule, self, other) {
  const actor = activity.actor;
  if ( !activity.roll?.formula ) return;
  const roll = await new Roll(activity.roll.formula, activity.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${activity.item.name} : ${activity.roll.name || "CA"}` });
  const answer = (other?.actor && (other !== self)) ? await askChoice(actor, {
    actor: actor.uuid, item: activity.item.name, prompt: loc("ChasseCroise.Qui", { item: activity.item.name, n: roll.total }),
    options: [{ id: "self", label: self.name }, { id: "other", label: other.name }]
  }) : null;
  const recipient = (answer?.id === "other") ? other.actor : actor;
  const effect = await placeAcBonus(activity, rule, recipient, roll.total, `${activity.item.name} (+${roll.total})`);
  if ( !effect ) return;
  log(`${activity.item.name}: +${roll.total} to ${recipient.name}'s AC`);
}

/** Commander's Strike: the order noted in the target creature's budget, the die promised to its damage. */
async function commandStrike(activity, actor, ally) {
  if ( !ally?.actor || (ally.actor === actor) ) return;
  const formula = dieOf(activity);
  const turn = currentTurnKey();
  const combatant = combatantFor(ally.actor);
  if ( combatant ) await writeBudget(combatant, { ...readBudget(combatant), commanded: { turn, by: actor.uuid } });
  if ( formula ) await ally.actor.setFlag(MODULE_ID, FLAG, { item: activity.item.uuid, name: activity.item.name, formula, against: "any", target: null, turn });
  await say({ actor }, locEsc("FrappeCommandee.Carte", { item: activity.item.name, name: ally.name, formula: formula ?? "" }),
    { commandStrike: { item: activity.item.uuid, ally: ally.uuid } });
  notice(ally, loc("FrappeCommandee.Ordre", { item: activity.item.name }), "gain");
  log(`${activity.item.name}: ${ally.name} can attack with its Reaction (+${formula})`);
}

/** On the active GM: the use card of a "Criss-Cross" or Commander's Strike activity. */
async function onUsageCard(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const entry = activity?.item ? contentOf(activity.item).entry : null;
  if ( !entry || !activity.actor ) return;
  const self = speakerTokenOf(message) ?? tokenOf(activity.actor);
  const other = fromUuidSync(message.system?.targets?.[0]?.token ?? "", { strict: false });
  if ( entry.commandStrike?.activity === activity.id ) await commandStrike(activity, activity.actor, other);
  const swapped = (entry.swapPlaces?.activity === activity.id) && self ? await swapPlaces(activity.item, self, other) : true;
  if ( swapped && (entry.rolledAc?.activity === activity.id) && (entry.rolledAc.to === "choose") && self ) await chosenAc(activity, entry.rolledAc, self, other);
}

/**
 * §279, on the active GM: a missed attack that answered the maximum promise loses it; a hit creature that carried a `maxNextHit`
 * effect loses it (its maximum hit has passed).
 */
async function settleMaxDamage(resolution, actor) {
  const promise = actor?.getFlag?.(MODULE_ID, MAX_FLAG);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( promise && (resolution.step === STEPS.MISSED) && maxPromiseFits(promise, activity) ) {
    await actor.unsetFlag(MODULE_ID, MAX_FLAG);
    log(`${promise.name}: the attack missed, the promise is lost`);
  }
  if ( resolution.step !== STEPS.DONE ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    const gone = maxNextHitEffects(target).filter(e => e.parent === target).map(e => e.id);
    if ( gone.length ) {
      await target.deleteEmbeddedDocuments("ActiveEffect", gone);
      log(`${target.name}: maximum-damage mark spent`);
    }
  }
}

export function registerManeuverDice() {
  route("createChatMessage", onUsageCard, { executor: true, label: "maneuver: Bait and Switch or Commander's Strike not played" });
  route("dnd5e.postUseActivity", onPostUse, { label: "maneuver: promised die or AC not applied" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "maneuver: promised die" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "maneuver: promised die not cleared" });
}
