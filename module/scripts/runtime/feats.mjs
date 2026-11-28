/**
 * §129: origin feats from the Player's Handbook, at the damage roll (on the author's client, `dnd5e.preRollDamageV2`).
 *
 *  - Savage Attacker (`savageAttacker`): once per turn, on a weapon's damage roll (not an unarmed strike), its dice
 *    are rolled twice and the better kept (core/feats.mjs, `twiceKeepHighest`). The "either" choice is always the
 *    better. §516: the hit is chosen (checkbox of the "on hit" window, setting `savageAttackerMode`). Out of combat, every hit.
 *  - Healer (`healingRerolls`): on a spell's healing dice, a 1 is rerolled once (`rerollOnesOnce`). The feat's Battle Medic
 *    already carries the reroll in its data.
 * Elsewhere: Tavern Brawler (boon `hitRider`, adapter/smite.mjs), Lucky (`rollBonus.luck`, adapter/inspiration.mjs; its
 * window before an attack, content/feats.mjs), Alert (`initiativeSwap`, runtime/roll-bonus.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { twiceKeepHighest, rerollOnesOnce, oneMoreKeepBest, resistanceRuleCovers } from "../core/feats.mjs";
import { ownConditionsRule, pickOwnCondition, turnStartHealDue, deathSaveCriticalOf } from "../core/self-care.mjs";
import { spendsCharges, chargesKept } from "../core/charges.mjs";
import { STEPS } from "../core/action.mjs";
import { onVitalityResolution } from "./vitality.mjs";
import { attackDamageTypes } from "../adapter/smite.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { onMarkSplashResolution } from "./mark-splash.mjs";
import { victimsOf, grappleEffectsOf, grapplerOf } from "../adapter/grapple.mjs";
import { onHeldEffectCreated, onHeldEffectEnded } from "./held-effect.mjs";
import { enqueue } from "./queue.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { factsFor } from "../adapter/facts.mjs";
import { holds } from "../core/triggers.mjs";
import { combatantFor, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { savageApplies, savageSpent, savageTurnOf, SAVAGE_MODE_SETTING, SAVAGE_MODES } from "../adapter/savage.mjs";
import { breaksConcentration } from "../core/concentration-breaker.mjs";
import { route } from "./router.mjs";
import { log, loc, say, locEsc, waitForDice } from "./shared.mjs";
import { empoweredPicks, empoweredDeltas } from "../core/empowered.mjs";
import { overchannelApplies, maximizedDeltas, backlashDice } from "../core/overchannel.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { damageDice } from "../adapter/heroic.mjs";
import { usesLeftFor } from "../adapter/inspiration.mjs";

const hasRule = (actor, key) => Array.from(actor?.items ?? []).some(i => contentOf(i).entry?.[key] === true);

/** The combat turn in which the actor fights ("combat.round.turn"), or null outside combat. */
function turnOf(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

function onPreRollDamage(config, dialog, message) {
  const activity = config.subject;
  const actor = activity?.actor;
  if ( !actor || !config.rolls?.length ) return true;
  // §283: damage that the data leaves without a type (Otiluke's Freezing Sphere) takes the one the item's content declares.
  const untyped = activity.item ? contentOf(activity.item).entry?.untypedDamage : null;
  if ( untyped ) {
    for ( const roll of config.rolls ) {
      roll.options ??= {};
      if ( roll.options.type || roll.options.types?.length ) continue;
      roll.options.type = untyped;
      roll.options.types = [untyped];
      log(`${activity.item.name}: untyped damage rolled as ${untyped}`);
    }
  }
  // Survey of gaps: Combat Inspiration, Attack — the die already rolled (adapter/messages.mjs),
  // as a fixed part of the attack's type.
  const inspired = Number(config[MODULE_ID]?.combatInspiration) || 0;
  if ( inspired ) {
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    config.rolls.push({ data: base.data ?? {}, parts: [String(inspired)], options: { type: base.options?.type, types: base.options?.types ?? [], properties: [] } });
    log(`Combat Inspiration: +${inspired} damage`);
  }
  // Healer: a spell's healing dice.
  if ( (activity.type === "heal") && (activity.item?.type === "spell") && hasRule(actor, "healingRerolls") ) {
    for ( const roll of config.rolls ) roll.parts = (roll.parts ?? []).map(rerollOnesOnce);
    log(`Healer: 1s rerolled once on ${activity.item.name}'s healing dice`);
  }
  // Savage Attacker: the weapon's part of a weapon hit, once per turn. §516: declined in the "on hit" window
  // (`savageAttacker: false`, adapter/savage.mjs), it stays for another hit of the turn; with no answer (card button roll,
  // "auto" mode), it is applied automatically on the first hit of the turn.
  const savage = config[MODULE_ID]?.savageAttacker;
  if ( (savage === false) && savageApplies(activity) ) log(`Savage Attacker: kept for another hit (${actor.name})`);
  else if ( savageApplies(activity) && !savageSpent(actor) ) {
    const turn = savageTurnOf(actor);
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? twiceKeepHighest(p) : p));
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.savageAttacker`, true);
    if ( turn ) actor.setFlag(MODULE_ID, "savageAttacker", turn).catch(() => null);
    log(`Savage Attacker: ${base.parts[0]}`);
  }
  // §134: Elemental Adept — "when you roll damage for a spell of that type, a 1 on a die counts as a 2".
  if ( activity.item?.type === "spell" ) {
    const types = elementalTypes(actor);
    for ( const roll of types.length ? config.rolls : [] ) {
      const rt = [roll.options?.type, ...(roll.options?.types ?? [])].filter(Boolean);
      if ( !rt.some(t => types.includes(t)) ) continue;
      roll.parts = (roll.parts ?? []).map(p => String(p).replace(/(\d*d\d+)((?:[a-z]+\d*)*)/g, (term, dice, mods) => (/min/.test(mods) ? term : `${dice}min2${mods}`)));
      log(`Elemental Adept: ${roll.parts.join(" + ")}`);
    }
  }
  // §135: Boon of Irresistible Offense, Overwhelming Strike — "when you roll a 20 on the d20 of an attack roll, extra damage
  // equal to the value of the ability the boon increased, of the attack's type". The engine reads the critical (a lowered
  // threshold counts too).
  const strike = (activity.type === "attack") ? ruleItem(actor, "overwhelmingStrike") : null;
  if ( strike && (config.isCritical || config.rolls.some(r => r.options?.isCritical)) ) {
    const ability = boostedAbility(strike);
    const score = ability ? Number(actor.system.abilities?.[ability]?.value) : 0;
    const base = config.rolls.find(r => r.base) ?? config.rolls[0];
    const type = base.options?.type ?? base.options?.types?.[0] ?? null;
    if ( score > 0 ) {
      config.rolls.push({ parts: [String(score)], options: { type, types: type ? [type] : [], properties: [] } });
      log(`${strike.name}: +${score} ${type ?? ""} (critical hit)`);
    }
  }
  // §132: Piercer — an attack that deals piercing damage.
  if ( (activity.type === "attack") && attackDamageTypes(activity).includes("piercing") && hasRule(actor, "piercer") ) {
    for ( const roll of config.rolls ) {
      roll.options ??= {};
      roll.options.critical = { ...(roll.options.critical ?? {}), bonusDice: (Number(roll.options.critical?.bonusDice) || 0) + 1 };
    }
    const turn = turnOf(actor);
    if ( !turn || (actor.getFlag(MODULE_ID, "piercer") !== turn) ) {
      const base = config.rolls.find(r => r.base) ?? config.rolls[0];
      const before = base.parts?.[0];
      base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? oneMoreKeepBest(p) : p));
      if ( (base.parts[0] !== before) && turn ) actor.setFlag(MODULE_ID, "piercer", turn).catch(() => null);
      log(`Piercer: ${base.parts[0]} (one more die on a critical hit)`);
    }
  }
  return true;
}

/* -------------------------------------------- */
/*  §132 : marques de coup critique              */
/* -------------------------------------------- */

const seen = new Set();

/** After a resolved attack (active GM): each target hit by a Critical Hit of the right type receives the mark of the author's feats. */
/**
 * Survey of gaps (2026-10-22): Remarkable Athlete — "immediately after you score a Critical Hit, you can move up to half
 * your Speed without provoking Opportunity Attacks". Into the turn's budget, like Tactical Shift (§21): half the
 * Speed more, and no more Opportunity Attack that turn (simplification: the rest of the turn, not just this movement). On its
 * own turn only (an Opportunity Attack critical moves nobody).
 */
async function critMove(resolution, source) {
  if ( !(resolution.targets ?? []).some(t => t.hit && t.critical) ) return;
  const item = source.items.find(i => contentOf(i).entry?.critMove === true);
  const combatant = item ? combatantFor(source) : null;
  if ( !combatant || (combatant.combat?.combatant?.id !== combatant.id) ) return;
  const movement = movementOf(combatant, readUnitFactors());
  if ( !movement ) return;
  const budget = readBudget(combatant);
  await writeBudget(combatant, { ...budget, bonusMove: (Number(budget.bonusMove) || 0) + (movement.speed / 2), disengaged: true });
  log(`${item.name}: critical hit, ${source.name} may move +${movement.speed / 2} ${movement.units} without provoking Opportunity Attacks`);
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  seen.add(resolution.id);
  // `resolution.source`: the uuid of the author ACTOR (runtime/felled.mjs compares it to `token.actor.uuid`).
  const from = fromUuidSync(resolution.source ?? "", { strict: false });
  const source = (from?.documentName === "Actor") ? from : (from?.actor ?? null);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( !source || !activity ) return;
  await halt(resolution, source);   // §133
  await critMove(resolution, source);
  await hitDefense(resolution, source);   // C12-e
  await eldritchStrike(resolution, source, activity);   // C12-e
  const rules = source.items.map(i => ({ item: i, rule: contentOf(i).entry?.critMark })).filter(r => r.rule);
  if ( !rules.length ) return;
  const types = attackDamageTypes(activity);
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit || !t.critical ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || ((target.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const { item, rule } of rules ) {
      if ( !types.includes(rule.damageType) ) continue;
      const name = loc(`CoupCritique.${rule.side}`, { item: item.name });
      await target.createEmbeddedDocuments("ActiveEffect", [{ name, img: item.img, origin: item.uuid, transfer: false, disabled: false,
        changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
        flags: { [MODULE_ID]: { critMark: { side: rule.side, source: source.uuid, item: item.uuid } } } }]);
      log(`${item.name}: critical hit, "${name}" placed on ${target.name}`);
    }
  }
}

/* -------------------------------------------- */
/*  §135: epic boons                               */
/* -------------------------------------------- */

const ruleItem = (actor, key) => Array.from(actor?.items ?? []).find(i => contentOf(i).entry?.[key] === true) ?? null;

/**
 * Boon of Combat Prowess, Peerless Aim — "when you miss with an attack roll, you can hit instead; you can't
 * do so again until the start of your next turn". For the player; in combat, once until their next turn (flag
 * removed at the start of their turn). true: the attack hits.
 */
export async function offerPeerlessAim(actor, { total, needed }) {
  const item = ruleItem(actor, "peerlessAim");
  if ( !item ) return false;
  const combat = combatantFor(actor)?.parent;
  if ( combat?.started && actor.getFlag(MODULE_ID, "peerlessAim") ) return false;
  const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Prouesse.Question", { item: item.name, total, needed }),
    options: [{ id: "no", label: loc("BonusJet.Non") }, { id: "yes", label: loc("Prouesse.Oui") }] });
  if ( answer?.id !== "yes" ) return false;
  if ( combat?.started ) await actor.setFlag(MODULE_ID, "peerlessAim", true);
  await say({ actor }, locEsc("Prouesse.Carte", { item: item.name, name: actor.name }));
  log(`${item.name}: ${actor.name}'s missed attack hits instead`);
  return true;
}

/** Boon of Fortitude — the Constitution modifier added to a heal, once per turn (in combat). 0 otherwise. Active GM. */
export async function fortifiedExtra(actor) {
  const item = ruleItem(actor, "fortifiedHealing");
  const con = Number(actor?.system?.abilities?.con?.mod) || 0;
  if ( !item || !(con > 0) ) return 0;
  // §289: "you can't do so again until the start of your next turn" — in combat, the flag drops at the start of the
  // bearer's turn (like Peerless Aim), not at each turn of another combatant. Out of combat: no turns, no limit.
  const inCombat = !!combatantFor(actor)?.parent?.started;
  if ( inCombat && actor.getFlag(MODULE_ID, "fortifiedHealing") ) return 0;
  if ( inCombat ) await actor.setFlag(MODULE_ID, "fortifiedHealing", true);
  log(`${item.name}: +${con} HP for ${actor.name}`);
  return con;
}

/** Boon of Irresistible Offense, Overwhelming Strike: the ability the boon increased (its "Increase" step). */
function boostedAbility(item) {
  for ( const adv of item.system.advancement ?? [] ) {
    const assigned = Object.entries(adv.value?.assignments ?? {}).find(([, n]) => n > 0);
    if ( (adv.type === "AbilityScoreImprovement") && assigned ) return assigned[0];
  }
  return null;
}

/**
 * Boon of Spell Recall, Free Casting — "when you cast a spell using a level 1 to 4 spell slot, roll 1d4; if
 * the roll equals the slot's level, it is not expended". On the caster's client, after use.
 */
async function spellRecall(activity, usageConfig) {
  const actor = activity?.actor;
  const item = ruleItem(actor, "spellRecall");
  const slot = usageConfig?.spell?.slot;
  if ( !item || !slot || !activity.requiresSpellSlot || !activity.consumption?.spellSlot ) return;
  const level = Number(actor.system.spells?.[slot]?.level) || Number(String(slot).replace("spell", "")) || 0;
  if ( !(level >= 1) || (level > 4) ) return;
  const roll = await new Roll("1d4").evaluate();
  const kept = roll.total === level;
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc(kept ? "RappelSorts.Garde" : "RappelSorts.Depense", { item: item.name, level }) });
  if ( kept ) await actor.update({ [`system.spells.${slot}.value`]: (Number(actor.system.spells[slot].value) || 0) + 1 });
  log(`${item.name}: 1d4 = ${roll.total} for a level ${level} slot — ${kept ? "slot kept" : "slot spent"}`);
}

/* -------------------------------------------- */
/*  §134: ignored Resistances, Elemental Adept */
/* -------------------------------------------- */

/** The types that Elemental Adept can choose. */
export const ELEMENTAL_TYPES = Object.freeze(["acid", "cold", "fire", "lightning", "thunder"]);

/** The types chosen by the actor's Elemental Adepts (the feat can be taken again, one type each time). */
function elementalTypes(actor) {
  return Array.from(actor?.items ?? []).filter(i => contentOf(i).entry?.elementalAdept === true)
    .map(i => i.getFlag(MODULE_ID, "elementalType")).filter(t => ELEMENTAL_TYPES.includes(t));
}

/**
 * On damage application (active GM): the types whose Resistance is ignored for this activity — Poisoner (`ignoresResistance`,
 * "a damage roll that deals poison damage ignores Resistance to poison"), Elemental Adept (the chosen type, for a spell).
 */
export function resistanceIgnoredBy(actor, activity) {
  if ( !actor ) return [];
  const out = new Set();
  for ( const i of actor.items ) {
    const rule = contentOf(i).entry?.ignoresResistance;
    if ( !rule || !ignoresFor(rule, i, actor, activity) ) continue;
    for ( const t of rule.types ?? [] ) out.add(t);
  }
  if ( activity?.item?.type === "spell" ) for ( const t of elementalTypes(actor) ) out.add(t);
  return Array.from(out);
}

/**
 * §447: does this item's `ignoresResistance` rule apply to this activity? `from`: one of its activities, or a spell copy
 * that one of them caused to be cast (`flags.dnd5e.cachedFor` = "…Item.<item>.Activity.<activity>", activity/cast.mjs) —
 * "Touch of Death", "this spell only"; `if`: the condition, the author as `source`.
 */
function ignoresFor(rule, item, actor, activity) {
  if ( rule.from && !resistanceRuleCovers(rule.from, { itemId: item.id, activityItemId: activity?.item?.id, activityId: activity?.id,
    cachedFor: activity?.item?.flags?.dnd5e?.cachedFor }) ) return false;
  return !rule.if || holds(rule.if, factsFor({ source: actor, activity }));
}

/**
 * Elemental Adept: the type question, put to the player (else the GM), noted on the item. Active GM, when the feat
 * arrives and on load. §137: without delay — a choice made once; closed with no answer, nothing is noted and the question
 * comes back at the next load (until then, the feat applies to no type).
 */
async function askElementalType(item) {
  if ( !item?.actor || (contentOf(item).entry?.elementalAdept !== true) || ELEMENTAL_TYPES.includes(item.getFlag(MODULE_ID, "elementalType")) ) return;
  const taken = new Set(elementalTypes(item.actor));
  const options = ELEMENTAL_TYPES.filter(t => !taken.has(t)).map(t => ({ id: t, label: game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t) }));
  if ( !options.length ) return;
  const answer = await askChoice(item.actor, { actor: item.actor.uuid, item: item.name, prompt: loc("ExpertElementaire.Question", { item: item.name }), options, untimed: true });
  const type = answer?.id;
  if ( !ELEMENTAL_TYPES.includes(type) ) return;
  await item.setFlag(MODULE_ID, "elementalType", type);
  log(`${item.actor.name}: ${item.name}, damage type ${type}`);
}

/* -------------------------------------------- */
/*  §133: feat reactions                          */
/* -------------------------------------------- */

const shieldOf = actor => (actor?.items ?? []).find(i => (i.type === "equipment") && (i.system.type?.value === "shield") && i.system.equipped) ?? null;

/**
 * Shield Master, Interpose Shield — "subjected to an effect that allows a Dexterity saving throw to take only half
 * damage, you can use a Reaction to take no damage if you succeed on the save, while holding a shield". Offered after
 * the success (active GM, to the creature's player); the Reaction is spent. true: no damage.
 */
export async function offerInterpose(actor) {
  const item = (actor?.items ?? []).find(i => contentOf(i).entry?.interposeShield === true);
  if ( !item || !shieldOf(actor) ) return false;
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return false;
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget && !((budget.reaction ?? 1) >= 1) ) return false;
  const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Interposer.Question", { item: item.name }),
    options: [{ id: "no", label: loc("Interposer.Non") }, { id: "yes", label: loc("Interposer.Oui") }] });
  if ( answer?.id !== "yes" ) return false;
  if ( budget ) await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1) });
  log(`${actor.name}: ${item.name}, no damage on a successful Dexterity saving throw (Reaction)`);
  return true;
}

/**
 * §523: the marks this client has just placed, read without waiting for their write. The NPC's Concentration save is rolled
 * by the active GM — the one that places the mark — while the flag is still being written (seen on the test bench: the save
 * went out before the end of `setFlag`, without the Disadvantage). The flag stays for the save rolled by another client
 * (the player of a concentrating character).
 * @type {Map<string, {source: string, at: number}>}
 */
const freshBreakers = new Map();

/**
 * Mage Slayer, Concentration Breaker — the author wounds a concentrating creature: its next Concentration roll has Disadvantage.
 * @returns {Promise<boolean>}  Is the mark placed?
 */
export async function markConcentrationBreaker(source, target, activity=null) {
  if ( !source || !target || (source === target) ) return false;
  // `"item"`: the object whose activity wounded, if it is with this bearer, equipped and attuned as needed
  // (core/concentration-breaker.mjs).
  // The object is re-read from the bearer's sheet by its id: a resolution's activity may come from a clone of the item.
  const item = activity?.item?.id ? (source.items?.get?.(activity.item.id) ?? null) : null;
  const itemReady = !!item && (item.system?.equipped !== false)
    && ((item.system?.attunement !== "required") || (item.system?.attuned === true));
  const applies = breaksConcentration({ owned: (source.items ?? []).map(i => contentOf(i).entry?.concentrationBreaker),
    item: item ? contentOf(item).entry?.concentrationBreaker : undefined, itemReady });
  if ( !applies ) return false;
  if ( !(target.concentration?.effects?.size > 0) ) return false;
  const mark = { source: source.name, at: Date.now() };
  freshBreakers.set(target.uuid, mark);
  await target.setFlag(MODULE_ID, "concentrationBreaker", mark);
  log(`Concentration breaker: ${target.name}'s next Concentration saving throw has Disadvantage (${source.name})`);
  return true;
}

/** The Concentration roll, on the client that rolls it: Disadvantage if there is a recent mark (under a minute), which drops. */
function onPreRollConcentration(config) {
  const actor = config?.subject;
  // Extended Spell: "if the spell requires Concentration, you have Advantage on saving throws to maintain it".
  if ( actor?.effects?.some(e => e.statuses?.has?.("concentrating") && e.getFlag(MODULE_ID, "extendedSpell")) ) {
    config.advantage = true;
    log(`Extended Spell: Advantage on ${actor.name}'s Concentration saving throw`);
  }
  const fresh = actor?.uuid ? freshBreakers.get(actor.uuid) : null;
  if ( fresh ) freshBreakers.delete(actor.uuid);
  const mark = fresh ?? actor?.getFlag?.(MODULE_ID, "concentrationBreaker");
  if ( !mark ) return true;
  if ( (Date.now() - (mark.at ?? 0)) <= 60000 ) {
    config.disadvantage = true;
    log(`Concentration breaker: Disadvantage on ${actor.name}'s Concentration saving throw (${mark.source})`);
  }
  if ( actor.isOwner ) {
    actor.unsetFlag(MODULE_ID, "concentrationBreaker").catch(() => null);
    // Read from memory: the flag may still be writing — also removed once written, so it does not apply to the next save.
    if ( fresh ) setTimeout(() => actor.unsetFlag(MODULE_ID, "concentrationBreaker").catch(() => null), 3000);
  }
  return true;
}

/** Sentinel, Halt — "when you hit a creature with an Opportunity Attack, its Speed becomes 0 for the rest of the turn". */
async function halt(resolution, source) {
  const items = source.items.filter(i => contentOf(i).entry?.haltOnReaction);
  if ( !items.length ) return;
  const usage = game.messages.get(resolution.origin ?? "");
  if ( !usage?.getFlag(MODULE_ID, "reaction") ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || ((target.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    for ( const item of items ) {
      const effect = item.effects.get(contentOf(item).entry.haltOnReaction.effect);
      if ( !effect ) continue;
      const data = foundry.utils.mergeObject(effect.toObject(), { origin: item.uuid, transfer: false, disabled: false }, { inplace: false });
      delete data._id;
      await target.createEmbeddedDocuments("ActiveEffect", [data]);
      log(`${item.name}: ${target.name} hit by an opportunity attack, Speed 0 for the rest of the turn`);
    }
  }
}

/**
 * C12-e: Defensive Tactics, Multiattack Defense — "when a creature hits you with an attack roll, it has Disadvantage on
 * its other attack rolls against you for the rest of the turn" (`hitDefense`). A mark on the attacker, removed at turn change.
 */
async function hitDefense(resolution, source) {
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || (target === source) ) continue;
    const item = Array.from(target.items).find(i => contentOf(i).entry?.hitDefense === true);
    if ( !item ) continue;
    if ( source.effects.some(e => e.getFlag(MODULE_ID, "hitDefense")?.against === target.uuid) ) continue;
    await source.createEmbeddedDocuments("ActiveEffect", [{ name: loc("DefenseMultiattaque", { item: item.name, name: target.name }), img: item.img,
      origin: item.uuid, transfer: false, disabled: false, changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
      flags: { [MODULE_ID]: { hitDefense: { against: target.uuid, item: item.uuid } } } }]);
    log(`${item.name}: ${source.name} hit ${target.name}, Disadvantage on its other attacks against it this turn`);
  }
}

/**
 * C12-e: "Occult Weakening" — a weapon hit by the Eldritch Knight marks the target; its next save against a spell of
 * the author, before the end of the author's next turn, has Disadvantage (adapter/saves.mjs). One mark per author, renewed.
 */
async function eldritchStrike(resolution, source, activity) {
  const item = Array.from(source.items).find(i => identifierOf(i).id === "eldritch-strike");
  if ( !item || (activity.type !== "attack") || (activity.item?.type !== "weapon") ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( !t.hit ) continue;
    const target = fromUuidSync(t.token, { strict: false })?.actor;
    if ( !target || (target === source) ) continue;
    const old = target.effects.filter(e => e.getFlag(MODULE_ID, "eldritchStrike")?.source === source.uuid).map(e => e.id);
    if ( old.length ) await target.deleteEmbeddedDocuments("ActiveEffect", old);
    await target.createEmbeddedDocuments("ActiveEffect", [{ name: loc("Fragilisation", { item: item.name }), img: item.img, origin: item.uuid,
      transfer: false, disabled: false, changes: [], showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
      flags: { [MODULE_ID]: { eldritchStrike: { source: source.uuid, round: game.combat?.round ?? null } } } }]);
    log(`${item.name}: ${target.name} has Disadvantage on its next saving throw against ${source.name}'s spells`);
  }
}

/**
 * C12-e: Multiattack Defense marks drop at turn change; likewise what a reaction gave "until the end of
 * the current turn" (`untilTurnChange`: the Resistance of the Hunter's Superior Defense, runtime/reactions.mjs).
 */
async function dropHitDefense() {
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    const actor = token.actor;
    const ids = (actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "hitDefense") || e.getFlag(MODULE_ID, "untilTurnChange"))
      .map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/** Removes the marks an author has placed (at the start of their turn, at the end of combat). */
async function dropMarks(sourceUuid) {
  for ( const token of canvas?.scene?.tokens ?? [] ) {
    const actor = token.actor;
    const ids = (actor?.effects ?? []).filter(e => e.getFlag(MODULE_ID, "critMark")?.source === sourceUuid).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/** §132: Unarmed Fighting — "at the start of each of your turns, 1d4 bludgeoning damage to a creature you are grappling". */
async function grappleDamage(actor, token) {
  const item = actor.items.find(i => contentOf(i).entry?.grappleDamage);
  if ( !item || !token ) return;
  const rule = contentOf(item).entry.grappleDamage;
  // `grapplers: true`: those that also grapple it (the actor read at the origin of each Grappled condition it carries), once
  // each.
  const struck = new Map(victimsOf(token).map(t => [t.uuid, t]));
  if ( rule.grapplers === true ) {
    for ( const effect of grappleEffectsOf(actor) ) {
      const holder = grapplerOf(effect);
      const holderToken = holder?.token ?? holder?.getActiveTokens?.(false, true)?.find(t => t.parent === token.parent) ?? null;
      if ( holderToken && (holderToken.uuid !== token.uuid) ) struck.set(holderToken.uuid, holderToken);
    }
  }
  for ( const victim of struck.values() ) {
    const logged = await inflict({ step: { formula: rule.formula, damageType: rule.damageType }, item, targetUuid: victim.uuid, properties: [],
      speaker: ChatMessage.implementation.getSpeaker({ token }), flavor: loc("CoupCritique.Empoignade", { item: item.name, name: victim.name }),
      flags: { grappleDamage: { item: item.uuid, target: victim.uuid } } });
    log(`${item.name}: ${victim.name} takes ${rule.formula} ${rule.damageType}${logged ? ` (HP ${logged.before?.value} -> ${logged.after?.value})` : ""}`);
  }
}

/**
 * §236: Self-Restoration — "at the end of each of your turns, you can end one of these conditions on yourself: Charmed,
 * Frightened, Poisoned". The first one the creature has, in the rule's order; the effects that carry it are removed. Active GM.
 * §278: the rule also gives the moment (`at`), a level of Exhaustion in lieu of a condition, and the cost of one use of the item.
 */
async function endOwnCondition(actor, at) {
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return;
  for ( const item of actor.items.filter(i => contentOf(i).entry?.endsOwnConditions) ) {
    const rule = ownConditionsRule(contentOf(item).entry.endsOwnConditions);
    if ( rule.at !== at ) continue;
    const uses = item.system?.uses;
    const usesLeft = Number(uses?.max) ? (Number(uses.max) - (Number(uses.spent) || 0)) : null;
    const pick = pickOwnCondition(rule, { statuses: actor.statuses, exhaustion: Number(actor.system.attributes?.exhaustion) || 0, usesLeft });
    if ( !pick ) continue;
    if ( pick.status ) {
      const effects = actor.effects.filter(e => e.statuses?.has?.(pick.status));
      if ( effects.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(e => e.id));
    }
    else await actor.update({ "system.attributes.exhaustion": Math.max(0, (Number(actor.system.attributes.exhaustion) || 0) - 1) });
    if ( rule.uses ) await item.update({ "system.uses.spent": (Number(uses.spent) || 0) + 1 });
    log(`${item.name}: ${actor.name} ends ${pick.status ?? "one Exhaustion level"} on themself (${at === "turnStart" ? "start" : "end"} of turn)`);
    return;
  }
}

/** The object's uses before the use of one of its charged properties: the activity → what was spent. */
const chargesBefore = new Map();

/**
 * The sheet's object: after use, dnd5e passes the hooks a cloned (scaled) activity, whose item does not receive
 * the update of the uses.
 */
const ownedItemOf = activity => activity?.actor?.items?.get(activity?.item?.id) ?? activity?.item ?? null;

/** The bearer's `savesCharges` rule, when this activity spends charges of a magic item (core/charges.mjs), or null. */
function chargeRuleFor(activity) {
  const item = ownedItemOf(activity);
  const actor = activity?.actor;
  const rule = actor?.items ? actor.items.map(i => contentOf(i).entry?.savesCharges).find(Boolean) : null;
  if ( !rule || !item ) return null;
  const uses = item.system?.uses ?? {};
  return spendsCharges({ magical: item.system?.properties?.has?.("mgc") === true, consumable: item.type === "consumable",
    usesMax: Number(uses.max) || 0, recovers: (uses.recovery ?? []).length > 0, targets: activity.consumption?.targets ?? [],
    itemId: item.id }) ? rule : null;
}

function onPreUseCharges(activity) {
  if ( activity?.actor?.isOwner && chargeRuleFor(activity) ) {
    chargesBefore.set(activity.uuid, Number(ownedItemOf(activity).system.uses?.spent) || 0);
  }
  return true;
}

/**
 * Use Magic Device (Rogue 13): after a property that spent charges, the die — on a 6, the charges come back.
 * On the client that used the item.
 */
async function keepCharges(activity) {
  if ( !chargesBefore.has(activity?.uuid) ) return;
  const before = chargesBefore.get(activity.uuid);
  chargesBefore.delete(activity.uuid);
  const rule = chargeRuleFor(activity);
  const item = ownedItemOf(activity);
  const spent = (Number(item.system.uses?.spent) || 0) - before;
  if ( !rule || !(spent > 0) ) return;
  const actor = activity.actor;
  const owner = actor.items.find(i => contentOf(i).entry?.savesCharges);
  const roll = await new Roll(`1d${rule.die}`).evaluate();
  const kept = chargesKept(roll.total, rule);
  const card = await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format(`DND5ECOMBAT.Charges.${kept ? "Gardees" : "Depensees"}`,
      { feature: owner?.name ?? "", item: item.name, n: spent }),
    flags: { [MODULE_ID]: { savesCharges: { item: identifierOf(item).id, spent, kept } } } });
  if ( card ) await waitForDice(card);   // rule of the suite: the condition changes after the 3D dice
  if ( kept ) await item.update({ "system.uses.spent": before });
  log(`${actor.name}: ${owner?.name ?? "charges"} on ${item.name}, d${rule.die} = ${roll.total}`
    + `${kept ? `, ${spent} charge(s) kept` : ""}`);
}

/**
 * Empowered Spell (Metamagic, `spellDamageRerolls`): after the damage roll of a bearer's spell, the question — reroll the low
 * dice (up to `count`) against what the item's activity costs. The new rolls count. Returns what changes to the aggregate,
 * part by part (runtime/engine-messages.mjs). Simplification: the engine designates the dice (half their maximum or less,
 * the lowest); the player does not choose them one by one.
 */
export async function offerSpellDamageRerolls(actor, message) {
  if ( message.getAssociatedActivity?.()?.item?.type !== "spell" ) return [];
  const rolls = message.rolls?.filter(r => r instanceof CONFIG.Dice.DamageRoll) ?? [];
  if ( !rolls.length ) return [];
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.spellDamageRerolls;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    let count = 1;
    try { count = Number(Roll.safeEval(Roll.replaceFormulaData(rule.count, actor.getRollData()))) || 1; }
    catch { /* unreadable formula: one die */ }
    const dice = damageDice(rolls);
    const picked = empoweredPicks(dice, count).map(i => dice[i]);
    if ( !picked.length ) continue;
    const listed = picked.map(d => `d${d.faces}: ${d.value}`).join(", ");
    const answer = await askChoice(actor, { actor: actor.uuid, item: item.name,
      prompt: game.i18n.format("DND5ECOMBAT.SortRenforce.Question", { item: item.name, dice: listed, n: picked.length }),
      // "Keep" first: with no answer within the delay, askChoice takes the first option — nothing is spent without consent.
      options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.SortRenforce.Non") },
        { id: "yes", label: game.i18n.format("DND5ECOMBAT.SortRenforce.Oui", { n: picked.length }) }] });
    if ( answer?.id !== "yes" ) continue;
    const used = await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, { create: false })
      .catch(() => null);
    if ( !used ) return [];
    // Modifiers that bound the die ("min2") apply to the reroll too.
    const reroll = await new Roll(picked.map(d => `1d${d.faces}${d.modifiers.join("")}`).join(" + ")).evaluate();
    const values = reroll.dice.map(d => d.total);
    const deltas = empoweredDeltas(picked, values);
    const change = deltas.reduce((sum, d) => sum + d.now - d.old, 0);
    const card = await reroll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: game.i18n.format("DND5ECOMBAT.SortRenforce.Carte", { item: item.name, name: actor.name, old: listed,
        change: (change >= 0 ? "+" : "") + change }),
      flags: { [MODULE_ID]: { spellDamageRerolls: { item: identifierOf(item).id, old: picked.map(d => d.value),
        now: values } } } });
    if ( card ) await waitForDice(card);
    log(`${actor.name}: ${item.name}, ${picked.length} damage dice rerolled (${listed} → ${values.join(", ")})`);
    return deltas;
  }
  return [];
}

/**
 * Overchannel (Evoker 14, `overchannel`): after the damage roll of a wizard spell cast with a level 1 to 5 spell slot,
 * the question — maximum damage, with the backlash announced. If accepted, it applies to all damage rolls of that spell
 * this turn (the rays of one casting); the backlash, once, ignores Resistance and Immunity. Returns what changes to
 * the aggregate.
 * @param {Actor} actor
 * @param {ChatMessage} message  the damage roll card
 * @param {ChatMessage|null} usage  the spell's use card (its casting level)
 */
export async function offerOverchannel(actor, message, usage) {
  const spell = message.getAssociatedActivity?.()?.item;
  const rolls = message.rolls?.filter(r => r instanceof CONFIG.Dice.DamageRoll) ?? [];
  if ( !spell || !rolls.length ) return [];
  const item = actor.items.find(i => contentOf(i).entry?.overchannel);
  const rule = item ? contentOf(item).entry.overchannel : null;
  const castLevel = (Number(spell.system?.level) || 0) + (Number((usage ?? message).system?.scaling) || 0);
  if ( !overchannelApplies(rule, { isSpell: spell.type === "spell", baseLevel: Number(spell.system?.level) || 0, castLevel,
    sourceClass: spell.system?.sourceClass || null }) ) return [];
  const dice = damageDice(rolls);
  const deltas = maximizedDeltas(dice);
  const turn = currentTurnKey();
  const held = actor.getFlag(MODULE_ID, "overchannel");
  // Already accepted for this spell this turn: the other rolls of the same casting, with no new question or new backlash.
  if ( held && (held.spell === spell.uuid) && (held.turn === turn) && turn ) return deltas;
  if ( !deltas.length ) return [];
  const uses = item.system.uses ?? {};
  const use = (Number(uses.max) || 0) - (Number(uses.spent) || 0) + 1;
  const backlash = backlashDice(use, castLevel);
  const answer = await askChoice(actor, { actor: actor.uuid, item: item.name,
    prompt: game.i18n.format(`DND5ECOMBAT.Surcharge.${backlash ? "QuestionContrecoup" : "Question"}`,
      { item: item.name, spell: spell.name, level: castLevel, dice: backlash, die: rule.die }),
    // "Keep" first: with no answer within the delay, askChoice takes the first option.
    options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.Surcharge.Non") },
      { id: "yes", label: game.i18n.localize("DND5ECOMBAT.Surcharge.Oui") }] });
  if ( answer?.id !== "yes" ) return [];
  await item.update({ "system.uses.spent": Math.max(0, (Number(uses.spent) || 0) - 1) });
  await actor.setFlag(MODULE_ID, "overchannel", { spell: spell.uuid, turn });
  log(`${actor.name}: ${item.name}, maximum damage with ${spell.name} (use ${use}, level ${castLevel})`);
  if ( backlash ) {
    const roll = await new Roll(`${backlash}d${rule.die}`).evaluate();
    const card = await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: game.i18n.format("DND5ECOMBAT.Surcharge.Carte", { item: item.name, name: actor.name, total: roll.total }),
      flags: { [MODULE_ID]: { overchannel: { use, level: castLevel, backlash: roll.total } } } });
    if ( card ) await waitForDice(card);
    // "This damage ignores Resistance and Immunity."
    await actor.applyDamage([{ value: roll.total, type: "necrotic" }],
      { ignore: { resistance: new Set(["necrotic"]), immunity: new Set(["necrotic"]) } });
  }
  return deltas;
}

/**
 * Survivor (Champion 18), Heroic Rally: the item's healing activity, at the start of the turn of a Bloodied bearer who has at
 * least 1 Hit Point. The text leaves no choice ("you regain"): no question. Active GM.
 */
async function healAtTurnStart(actor) {
  const hp = actor.system.attributes?.hp;
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.turnStartHeal;
    if ( !turnStartHealDue(rule, { hp: Number(hp?.value) || 0, max: Number(hp?.effectiveMax ?? hp?.max) || 0 }) ) continue;
    const activity = item.system.activities?.get(rule.activity);
    if ( !activity ) continue;
    await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, {}).catch(() => null);
    log(`${item.name}: ${actor.name} heals at the start of their turn`);
    return;
  }
}

/** Survivor, Defy Death: the d20 of a death saving throw counts as a 20 from the declared threshold (`criticalSuccess`). */
function onPreRollDeathSave(config) {
  const actor = config?.subject;
  const roll = config?.rolls?.[0];
  if ( !actor?.items || !roll ) return true;
  const threshold = deathSaveCriticalOf(actor.items.map(i => contentOf(i).entry?.deathSaveCritical));
  if ( threshold === null ) return true;
  roll.options = { ...(roll.options ?? {}), criticalSuccess: Math.min(roll.options?.criticalSuccess ?? 20, threshold) };
  return true;
}

/**
 * §236: Indomitable Might — "if your total for a Strength check or Strength saving throw is less than your Strength score,
 * you can use that score in place of the total". At the roll, the d20 gets a minimum (`options.minimum`, like Portent): total
 * ≥ score ⇔ d20 ≥ score − bonus. A dice bonus (Bless) is counted at the lowest: the total may then exceed the score.
 */
function onPreRollD20(config) {
  const actor = config?.subject;
  const ability = config?.ability;
  if ( !actor?.items || !ability ) return true;
  const rule = actor.items.map(i => contentOf(i).entry?.scoreFloor).find(r => r?.includes(ability));
  const score = Number(actor.system?.abilities?.[ability]?.value);
  const roll = config.rolls?.[0];
  if ( !rule || !Number.isFinite(score) || !roll ) return true;
  let bonus;
  try { bonus = new Roll((roll.parts ?? []).join(" + ") || "0", roll.data ?? actor.getRollData()).evaluateSync({ minimize: true, strict: false }).total; }
  catch { return true; }
  const minimum = Math.max(roll.options?.minimum ?? 1, Math.min(20, score - bonus));
  if ( minimum <= 1 ) return true;
  roll.options = { ...(roll.options ?? {}), minimum };
  log(`${actor.name}: Indomitable Might, d20 at least ${minimum} (total at least ${score})`);
  return true;
}

function onTurnChange(combat, prior, current) {
  enqueue("hitDefense", dropHitDefense);
  const ended = combat.combatants.get(prior?.combatantId)?.actor;
  if ( ended ) enqueue(`feats-turn:${ended.uuid}`, () => endOwnCondition(ended, "turnEnd"));
  const combatant = combat.combatants.get(current?.combatantId);
  const actor = combatant?.actor;
  if ( !actor ) return;
  return enqueue(`feats-turn:${actor.uuid}`, async () => {
    await dropMarks(actor.uuid);
    if ( actor.getFlag(MODULE_ID, "peerlessAim") ) await actor.unsetFlag(MODULE_ID, "peerlessAim");   // §135: Peerless Aim
    if ( actor.getFlag(MODULE_ID, "fortifiedHealing") ) await actor.unsetFlag(MODULE_ID, "fortifiedHealing");   // §289: Fortified Health
    if ( (actor.system.attributes?.hp?.value ?? 0) > 0 ) await grappleDamage(actor, combatant.token);
    await endOwnCondition(actor, "turnStart");   // §278
    await healAtTurnStart(actor);
  });
}

export function registerFeats() {
  // §516: Savage Attacker asked on the hit (default) or applied automatically on the first weapon hit of the turn.
  game.settings.register(MODULE_ID, SAVAGE_MODE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SAVAGE_MODE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SAVAGE_MODE_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: Object.fromEntries(SAVAGE_MODES.map(m => [m, `DND5ECOMBAT.Reglage.${SAVAGE_MODE_SETTING}.${m}`])), default: "ask"
  });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`markSplash:${resolution?.id}`, () => onMarkSplashResolution(resolution)),
    { executor: true, label: "Superior Hunter's Prey: extra damage not offered" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "origin feats (damage)" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`critMark:${resolution?.id}`, () => onResolution(resolution)), { executor: true, label: "critical mark not placed" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "feat turn start" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`vitality:${resolution?.id}`, () => onVitalityResolution(resolution)),
    { executor: true, label: "Potent Spellcasting: Temporary Hit Points not offered" });
  for ( const hook of ["dnd5e.preRollAbilityCheckV2", "dnd5e.preRollSavingThrowV2"] ) route(hook, onPreRollD20, { cancellable: true, label: "Indomitable Might" });
  route("dnd5e.preRollDeathSaveV2", onPreRollDeathSave, { cancellable: true, label: "Survivor: death saves" });
  route("dnd5e.preRollConcentrationV2", onPreRollConcentration, { cancellable: true, label: "Mage Slayer: concentration" });
  route("dnd5e.postUseActivity", (activity, usageConfig) => (activity?.actor?.isOwner ? spellRecall(activity, usageConfig) : null), { label: "Boon of Spell Recall" });
  route("dnd5e.preUseActivity", onPreUseCharges, { cancellable: true, label: "Use Magic Device: charges not noted" });
  route("dnd5e.postUseActivity", activity => (activity?.actor?.isOwner ? keepCharges(activity) : null),
    { label: "Use Magic Device: charges" });
  // §134: Elemental Adept — the type, asked when the feat arrives, and on load for a feat already there.
  route("createItem", item => (item.parent?.documentName === "Actor" ? enqueue(`elemental:${item.uuid}`, () => askElementalType(item)) : null),
    { executor: true, label: "Elemental Adept: type not asked" });
  route("ready", () => { for ( const actor of game.actors ) for ( const item of actor.items ) enqueue(`elemental:${item.uuid}`, () => askElementalType(item)); },
    { executor: true, label: "Elemental Adept: type not asked" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`heldEffect:${resolution?.id}`, () => onHeldEffectEnded(resolution)),
    { executor: true, label: "Quivering Palm: vibrations not ended" });
  route("createActiveEffect", effect => enqueue(`heldEffect:${effect.uuid}`, () => onHeldEffectCreated(effect)),
    { executor: true, label: "Quivering Palm: one creature at a time" });
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => (c.actor ? dropMarks(c.actor.uuid) : null))), { executor: true, label: "critical marks not removed" });
}
