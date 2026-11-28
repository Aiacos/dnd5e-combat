/**
 * The system's messages turned into events of a resolution: use card, attack roll, damage roll, save,
 * Legendary Resistance. Extracted from runtime/engine.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { readAttackMessage, readDamageMessage, isCriticalExtra } from "../adapter/messages.mjs";
import { readSaveMessage, repairSaveAbility } from "../adapter/saves.mjs";
import { resolveAttack, hitsRegardless } from "../core/attack.mjs";
import { offerInspiration, offerRollBonus, keptD20 } from "../adapter/inspiration.mjs";
import { readUsage } from "../adapter/usage.mjs";
import { canResistSave, askLegendary, resistSave, legendaryLeft } from "../adapter/legendary.mjs";
import { offerInterpose, offerPeerlessAim, offerSpellDamageRerolls, offerOverchannel } from "./feats.mjs";
import { offerHeroicD20, offerHeroicDamage } from "./heroic.mjs";
import { hasHeroic } from "../adapter/heroic.mjs";
import { rerolledDamage } from "../core/heroic.mjs";
import { contentOf } from "../adapter/content.mjs";
import { critMargin } from "../adapter/criticals.mjs";
import { log, loc, waitForDice } from "./shared.mjs";
import { atCostMarginOf, holdForAtCost } from "./success-at-cost.mjs";
import { LOOKBACK, castLevelOfMessage, dispatcher, enrich, forcedThrough, openingFor, resolutionOn, serializeDamages, speakerTokenUuid } from "./engine.mjs";
import { saveResistApplies, saveReflectApplies } from "../core/save-resist.mjs";
import { combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { askChoice } from "../adapter/choices.mjs";

/* -------------------------------------------- */
/*  System messages → events                    */
/* -------------------------------------------- */

export function onUsageMessage(message) {
  // The opening enters the bearer's queue BEFORE any wait: a roll that the system chains
  // immediately (damage of a `damage` activity, healing) arrives after it, in order.
  return dispatcher.open(message.id, async () => {
    await repairSaveAbility(message);
    const usage = readUsage(message);
    if ( !usage ) return null;
    if ( usage.plan.variant ) log(`attack variant: ${usage.plan.variant.name || usage.plan.variant.kind} (${usage.plan.variant.kind})`);
    // §104: a module that itself supplies the targets of an area activity (Darsh Loot: a trap's area of effect) says so
    // through `flags.dnd5e-combat.givenTargets` on the use message: no template to wait for, the message's targets.
    if ( usage.area && !message.getFlag(MODULE_ID, "areaTick") && !message.getFlag(MODULE_ID, "givenTargets") ) {
      log("area of effect: waiting for the template to be placed");
      return null;
    }
    return openingFor(message, usage);
  });
}

/**
 * §33: Bardic Inspiration — an attack roll that misses a target (neither a natural 1 nor Total Cover): the inspired attacker may
 * add their die to the total, before the verdict. Returns the roll, possibly increased.
 */
async function inspiredAttack(message, roll, targets) {
  const actor = (await fromUuid(speakerTokenUuid(message) ?? ""))?.actor ?? message.getAssociatedActor?.() ?? null;
  // §282: Heroic Inspiration first, on any roll (a natural 1 too) — the new d20 redoes the Critical Hit and the automatic failure.
  roll = await heroicAttack(message, roll, targets, actor);
  // §304 (pass C9): Peerless Aim also applies on a natural 1 — a miss like any other; the blow hits, without a Critical Hit.
  if ( roll.isFumble && actor ) {
    const acs = targets.filter(t => !t.unaffected).map(t => t.ac).filter(Number.isFinite);
    const needed = acs.length ? Math.min(...acs) : null;
    if ( (needed !== null) && await offerPeerlessAim(actor, { total: roll.total, needed }) ) {
      return { ...roll, isFumble: false, total: Math.max(roll.total, needed), inspired: Math.max(0, needed - roll.total) };
    }
  }
  // A 19 at a lowered critical threshold that misses can still be recovered: only the roll that hits automatically (natural 20)
  // passes.
  if ( roll.isFumble || hitsRegardless(roll) ) return roll;
  const missed = resolveAttack(roll, targets.filter(t => !t.unaffected)).filter(t => t.reason === "miss");
  if ( !missed.length ) return roll;
  if ( !actor ) return roll;
  const needed = Math.min(...missed.map(t => t.ac));
  const bonus = await offerInspiration(actor, { what: loc("Inspiration.Attaque"), total: roll.total, needed });
  if ( bonus ) log(`${actor.name}: Bardic Inspiration, attack ${roll.total} + ${bonus} = ${roll.total + bonus}`);
  // §90: Precision Attack — still missed, the attacker may add their own die (`rollBonus` on "attack").
  const total = roll.total + bonus;
  const rules = actor.items.some(i => contentOf(i).entry?.rollBonus?.on?.includes("attack"));
  const precise = (rules && (total < needed))
    ? await offerRollBonus(actor, { kind: "attack", what: loc("Inspiration.Attaque"), total, needed,
      d20: roll.heroic?.kept ?? keptD20(message.rolls?.[0]), spell: message.getAssociatedActivity?.()?.item?.type === "spell" }) : 0;
  if ( precise ) log(`${actor.name}: die added to their attack, ${total} + ${precise} = ${total + precise}`);
  // §135: Boon of Combat Prowess, Peerless Aim — still missed: "you can hit instead".
  const peerless = ((total + precise) < needed) && await offerPeerlessAim(actor, { total: total + precise, needed }) ? needed - (total + precise) : 0;
  if ( !bonus && !precise && !peerless ) return roll;
  return { ...roll, total: total + precise + peerless, inspired: bonus + precise + peerless };
}

/**
 * §282: Heroic Inspiration on an attack roll — "missed" when at least one target is not hit (or a natural 1), the stated threshold
 * being the lowest AC of the missed targets (otherwise of the targets). Returns the roll, rerolled or not.
 */
async function heroicAttack(message, roll, targets, actor) {
  if ( !hasHeroic(actor) ) return roll;
  const live = targets.filter(t => !t.unaffected);
  const missed = resolveAttack(roll, live).filter(t => (t.reason === "miss") || (t.reason === "fumble"));
  const acs = (missed.length ? missed : live).map(t => t.ac).filter(Number.isFinite);
  const after = await offerHeroicD20(actor, { roll: message.rolls?.[0], what: loc("Inspiration.Attaque"), total: roll.total,
    needed: acs.length ? Math.min(...acs) : null, failed: missed.length > 0 });
  if ( !after ) return roll;
  log(`${actor.name}: Heroic Inspiration, attack ${roll.total} → ${after.total}`);
  // The kept d20 changed: without it (`natural` removed), a Critical Hit counts as a natural 20, as before.
  const { natural: _old, ...rest } = roll;
  return { ...rest, total: after.total, isCritical: after.critical, isFumble: after.fumble,
    ...(Number.isFinite(after.kept) ? { natural: after.kept } : {}), heroic: { old: after.old, kept: after.kept } };
}

export async function onAttackMessage(message) {
  const attack = readAttackMessage(message);
  if ( !attack?.targets.length ) {   // without a designated target, the roll stays a simple roll
    log("attack without a designated target: plain roll, nothing to resolve");
    return;
  }
  await waitForDice(message);
  const rolled = async plan => {
    const targets = await enrich(attack.targets, plan, speakerTokenUuid(message), attack.activity, message.rolls?.[0]?.options?.attackMode ?? message.system?.mode ?? null,
      // §406: the id of the origin card (`_source`) — `system.origin` is a ForeignDocumentField, reading it returns the
      // message itself.
      castLevelOfMessage(game.messages.get(message._source?.system?.origin ?? "") ?? message),
      // §518: an attack passed through a refusal (out of sight, range…) — Total Cover no longer nullifies it.
      { forced: forcedThrough(message) || forcedThrough(game.messages.get(attack.origin ?? "")) });
    // Issue #32: the margin of success at a cost for this roll (0: off, or not a player character) — judged by the core after
    // the Reactions.
    const attacker = (await fromUuid(speakerTokenUuid(message) ?? ""))?.actor ?? message.getAssociatedActor?.() ?? null;
    return { type: "attackRolled", roll: await inspiredAttack(message, attack.roll, targets), messageId: message.id, targets, critMargin: critMargin(),
      atCost: atCostMarginOf(attacker) };
  };
  // Le message d'utilisation attend ce jet : c'est lui le porteur.
  const awaited = attack.origin && await dispatcher.send(attack.origin, resolution =>
    ((resolution.step === STEPS.AWAITING_ATTACK) && (resolution.activity === attack.activity)) ? rolled(resolution.plan) : null);
  if ( awaited ) return;
  // Roll made outside a card, or rerolled from an already resolved card: it carries itself.
  await dispatcher.open(message.id, async () => {
    const usage = readUsage(message);
    if ( !usage?.plan.attack ) return null;
    return openingFor(message, { ...usage, origin: attack.origin, targets: [] }, { attack: await rolled(usage.plan) });
  });
}

/** Is this damage the resolution's: its activity, or a variant its plan allows (M5, §18.8)? */
const damageFits = (resolution, damage) => (resolution.activity === damage.activity)
  || (resolution.plan?.damageFrom ?? []).includes(damage.activity);

/** The most recent bearer still awaiting this activity's damage. */
function findAwaitingDamage(damage) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - LOOKBACK); i-- ) {
    const resolution = resolutionOn(messages[i]);
    if ( (resolution?.step !== STEPS.AWAITING_ROLLS) || !resolution.plan.damage || resolution.damageRoll ) continue;
    if ( !damageFits(resolution, damage) ) continue;
    if ( resolution.origin && damage.origin && (resolution.origin !== damage.origin) ) continue;
    return messages[i];
  }
  return null;
}

/** Damage or healing roll (same form). */
export async function onDamageMessage(message) {
  const damage = readDamageMessage(message);
  if ( !damage ) return;
  await waitForDice(message);
  // §282: Heroic Inspiration — a damage or healing die rerolled at will; its share of the aggregate moves by the difference.
  const actor = (await fromUuid(speakerTokenUuid(message) ?? ""))?.actor ?? message.getAssociatedActor?.() ?? null;
  const heroic = hasHeroic(actor) ? await offerHeroicDamage(actor, message.rolls?.filter(r => (r instanceof CONFIG.Dice.DamageRoll) && !isCriticalExtra(r)) ?? []) : null;
  if ( heroic ) {
    const sameProps = d => (d.properties.size === heroic.properties.length) && heroic.properties.every(p => d.properties.has(p));
    const part = damage.damages.find(d => (d.type === heroic.type) && sameProps(d)) ?? damage.damages.find(d => d.type === heroic.type);
    if ( part ) part.value = rerolledDamage(part.value, heroic.old, heroic.now);
  }
  // Empowered Spell (Metamagic): a spell's damage dice rerolled for 1 sorcery point; same aggregate shares.
  // Overchannel (Evoker 14) first: dice at maximum have nothing left to reroll.
  const maxed = actor ? await offerOverchannel(actor, message, game.messages.get(damage.origin ?? "") ?? null) : [];
  for ( const delta of [...maxed, ...((actor && !maxed.length) ? await offerSpellDamageRerolls(actor, message) : [])] ) {
    const sameProps = d => (d.properties.size === delta.properties.length) && delta.properties.every(p => d.properties.has(p));
    const part = damage.damages.find(d => (d.type === delta.type) && sameProps(d))
      ?? damage.damages.find(d => d.type === delta.type);
    if ( part ) part.value = rerolledDamage(part.value, delta.old, delta.now);
  }
  // #269 (§545): the extra critical dice rolled apart, for the Critical Hit targets only.
  const event = { type: "damageRolled", messageId: message.id, damages: serializeDamages(damage.damages),
    ...(damage.critical ? { critical: serializeDamages(damage.critical) } : {}) };
  const accepts = resolution => damageFits(resolution, damage) ? event : null;
  if ( damage.origin && await dispatcher.send(damage.origin, accepts) ) return;
  const carrier = findAwaitingDamage(damage);
  if ( carrier && await dispatcher.send(carrier.id, accepts) ) return;
  log("damage with no pending resolution: left to the system's tray");
}

/** Le porteur auquel se rapporte un jet de sauvegarde. */
/** Issue #32: is this save awaited by an engine resolution (which has its own pause)? */
export function saveInResolution(message) {
  const save = readSaveMessage(message);
  const carrierId = save?.actor ? carrierOfSave(save) : null;
  return !!(carrierId && resolutionOn(game.messages.get(carrierId)));
}

function carrierOfSave(save) {
  if ( save.request ) return game.messages.get(save.request)?.getFlag(MODULE_ID, "requestFor") ?? null;
  return save.origin;
}

export async function onSaveMessage(message) {
  const save = readSaveMessage(message);
  const carrierId = save?.actor ? carrierOfSave(save) : null;
  const carrier = game.messages.get(carrierId);
  const resolution = resolutionOn(carrier);
  if ( !resolution ) return;   // free save, outside any resolution
  await waitForDice(message);
  const dc = resolution.plan?.save?.dc;
  // §282: Heroic Inspiration first (a player character: no Legendary Resistance to arbitrate).
  const saver = await fromUuid(save.actor);
  const heroic = hasHeroic(saver) ? await offerHeroicD20(saver, { roll: message.rolls?.[0], what: loc("Inspiration.Sauvegarde"), needed: dc }) : null;
  if ( heroic ) save.total = heroic.total;
  const failed = Number.isFinite(dc) && (save.total < dc);
  // An intention can impose the choice (`legendary: "always" | "never"` on the use: scenarios, macros), like `saveChoice`.
  const forced = game.messages.get(resolution.origin ?? carrierId)?.getFlag(MODULE_ID, "legendary") ?? carrier.getFlag(MODULE_ID, "legendary");
  let resisted = failed ? await legendaryResistance(message, { dc, item: carrier.getAssociatedActivity?.()?.item?.name, forced }) : false;
  // Staff of Charming: "if you fail a saving throw against an enchantment spell that targets only you, you can
  // turn your failure into a success" (`saveResist`) — offered to the bearer, on uses of the item's activity.
  if ( failed && !resisted ) resisted = await declaredSaveResist(saver, carrier, resolution, { total: save.total, dc });
  // §33: Bardic Inspiration — a failed save: the inspired creature may add its die.
  let total = save.total;
  if ( failed && !resisted ) {
    const actor = await fromUuid(save.actor);
    const bonus = actor ? await offerInspiration(actor, { what: loc("Inspiration.Sauvegarde"), total, needed: dc }) : 0;
    if ( bonus ) { log(`${actor.name}: Bardic Inspiration, saving throw ${total} + ${bonus} = ${total + bonus}`); total += bonus; }
    // §38: Dark One's Own Luck — still missed, the creature may add its own die (`rollBonus`).
    const luck = (actor && (total < dc)) ? await offerRollBonus(actor, { kind: "save", what: loc("Inspiration.Sauvegarde"), total, needed: dc, statuses: saveStatuses(carrier, resolution), d20: heroic?.kept ?? keptD20(message.rolls?.[0]), ability: resolution.plan?.save?.ability ?? null }) : 0;
    if ( luck ) { log(`${actor.name}: die added to their saving throw, ${total} + ${luck} = ${total + luck}`); total += luck; }
  }
  // Issue #32: success at a cost — still missed by 1 or 2 after the aids: the GM's pause, before anything is applied.
  let atCost = null;
  if ( Number.isFinite(dc) && (total < dc) && !resisted ) {
    const saverDoc = saver ?? await fromUuid(save.actor);
    const answer = await holdForAtCost({ actor: saverDoc, token: saverDoc?.token ?? null, what: loc("Inspiration.Sauvegarde"), total, needed: dc, kind: "save" });
    if ( answer?.accepted ) atCost = { cost: answer.cost ?? null };
  }
  // §133: Shield Master, Interpose Shield — a successful Dexterity save against damage halved: the
  // Reaction to take none.
  const plan = resolution.plan ?? {};
  const halfDex = !!plan.damage && !!plan.save && !plan.save.chained && (plan.save.ability === "dex") && ((plan.save.onSave ?? "half") === "half");
  const interposed = (halfDex && Number.isFinite(dc) && ((total >= dc) || atCost)) ? await offerInterpose(await fromUuid(save.actor)) : false;
  // Staff of Charming, Reflect Enchantment: a successful save against an enchantment spell that targets only the
  // bearer — their Reaction and 1 charge to turn the spell back on its caster (`saveReflect`).
  const succeeded = Number.isFinite(dc) && !atCost && ((total >= dc) || !!resisted);
  const reflect = succeeded ? await declaredSaveReflect(saver, carrier, resolution) : null;
  await dispatcher.send(carrierId, { type: "saveRolled", actor: save.actor, total, messageId: message.id, ...(save.mode ? { mode: save.mode } : {}), ...(resisted ? { resisted: true } : {}),
    ...(interposed ? { interposed: true } : {}), ...(atCost ? { atCost } : {}) });
  if ( reflect ) await reflectSpell(reflect, saver, carrier);
}

/** `saveReflect`: offered to the bearer who has a charge and their Reaction; accepted, the charge and the Reaction are spent. */
async function declaredSaveReflect(saver, carrier, resolution) {
  const spell = carrier?.getAssociatedActivity?.()?.item;
  if ( !saver || !spell?.actor || (spell.actor === saver) ) return null;
  const against = { isSpell: spell.type === "spell", school: spell.system?.school ?? null,
    targets: (resolution.targets ?? []).length };
  const combatant = combatantFor(saver);
  const budget = combatant ? readBudget(combatant) : null;
  const reaction = budget ? ((budget.reaction ?? 1) >= 1) : null;
  for ( const item of saver.items ?? [] ) {
    const rule = contentOf(item).entry?.saveReflect;
    const charges = item.system?.uses?.value ?? 0;
    if ( (item.system?.equipped === false) || !saveReflectApplies(rule, against, { charges, reaction }) ) continue;
    const activity = item.system.activities?.get(rule.activity);
    if ( !activity ) continue;
    const answer = await askChoice(saver, { actor: saver.uuid, item: item.name,
      prompt: loc("RenvoyerSort.Question", { spell: spell.name, caster: spell.actor.name }),
      options: [{ id: "no", label: loc("RenvoyerSort.Non") },
        { id: "reflect", label: loc("RenvoyerSort.Oui", { item: activity.name }) }] });
    if ( answer?.id !== "reflect" ) continue;
    await item.update({ "system.uses.spent": (item.system.uses.spent ?? 0) + 1 });
    if ( budget ) await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1) });
    log(`${item.name}: ${saver.name} turns ${spell.name} back on ${spell.actor.name} (Reaction, 1 charge)`);
    return { item };
  }
  return null;
}

/**
 * The spell turned back "as if you had cast it": a copy of the spell on the bearer (their DC, their ability), marked and
 * replaced at the next reflection, whose activity plays against the original caster — nothing else is spent.
 */
async function reflectSpell(reflect, saver, carrier) {
  const original = carrier.getAssociatedActivity();
  const spell = original.item;
  const scene = carrier.speaker?.scene ? game.scenes.get(carrier.speaker.scene) : canvas.scene;
  const tokenOf = actor => actor?.getActiveTokens?.(false, true)?.find(t => t.parent === scene) ?? null;
  const source = tokenOf(saver);
  const target = tokenOf(spell.actor);
  if ( !source || !target ) return;
  const stale = saver.items.filter(i => i.getFlag(MODULE_ID, "reflected")).map(i => i.id);
  if ( stale.length ) await saver.deleteEmbeddedDocuments("Item", stale);
  const data = spell.toObject();
  delete data._id;
  data.name = loc("RenvoyerSort.Copie", { spell: spell.name });
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), reflected: true } };
  if ( data.flags.dnd5e ) delete data.flags.dnd5e.cachedFor;
  data.system.method = "innate";
  data.system.sourceClass = "";
  const [copy] = await saver.createEmbeddedDocuments("Item", [data]);
  const activity = copy?.system.activities?.get(original.id);
  if ( activity ) await strikeAgainst(activity, source, target, { flavor: "DND5ECOMBAT.RenvoyerSort.Carte" });
}

/**
 * §94: the conditions a save avoids (those of the activity's effects) or ends (the effect of a repeated save) — Survivor,
 * "to avoid or end the Charmed or Frightened condition".
 */
function saveStatuses(carrier, resolution) {
  const out = new Set();
  const item = carrier?.getAssociatedActivity?.()?.item;
  for ( const e of resolution?.plan?.effects ?? [] ) for ( const s of item?.effects?.get(e?.id ?? e)?.statuses ?? [] ) out.add(s);
  const resave = carrier?.getFlag?.(MODULE_ID, "resave")?.effect;
  for ( const s of (resave ? fromUuidSync(resave, { strict: false })?.statuses : null) ?? [] ) out.add(s);
  return Array.from(out);
}

/** `saveResist`: a carried item turns the failed save into a success, on uses of its activity; asked, never forced. */
async function declaredSaveResist(saver, carrier, resolution, { total, dc }) {
  const spell = carrier?.getAssociatedActivity?.()?.item;
  if ( !saver || !spell ) return false;
  const against = { isSpell: spell.type === "spell", school: spell.system?.school ?? null,
    targets: (resolution.targets ?? []).length };
  for ( const item of saver.items ?? [] ) {
    const rule = contentOf(item).entry?.saveResist;
    if ( !saveResistApplies(rule, against) || (item.system?.equipped === false) ) continue;
    const activity = item.system.activities?.get(rule.activity);
    if ( !activity || !((activity.uses?.value ?? 0) > 0) ) continue;
    const answer = await askChoice(saver, { actor: saver.uuid, item: item.name,
      prompt: loc("ResisterSort.Question", { spell: spell.name, total, dc }),
      options: [{ id: "keep", label: loc("ResisterSort.Non") },
        { id: "resist", label: loc("ResisterSort.Oui", { item: activity.name }) }] });
    if ( answer?.id !== "resist" ) continue;
    await activity.update({ "uses.spent": (activity.uses.spent ?? 0) + 1 });
    log(`${item.name}: ${saver.name} turns the failed saving throw against ${spell.name} (${total} vs DC ${dc}) into a success`);
    return true;
  }
  return false;
}

/**
 * §18.9: an NPC who fails a save may spend a Legendary Resistance (setting: ask, always, never).
 * The spending goes through the system (`resistSave`); the resolution counts the save as successful.
 */
async function legendaryResistance(message, { dc, item, forced=null }) {
  const mode = forced ?? game.settings.get(MODULE_ID, "legendaryResistance");
  if ( (mode === "never") || !canResistSave(message) ) return false;
  const actor = message.getAssociatedActor();
  const total = message.rolls?.[0]?.total;
  if ( (mode !== "always") && !(await askLegendary(actor, { total, dc, item })) ) {
    log(`${actor.name}: Legendary Resistance not used (${total} vs DC ${dc})`);
    return false;
  }
  await resistSave(message);
  log(`${actor.name}: Legendary Resistance — failed saving throw (${total} vs DC ${dc}) turned into a success, ${legendaryLeft(actor)} left`);
  return true;
}
