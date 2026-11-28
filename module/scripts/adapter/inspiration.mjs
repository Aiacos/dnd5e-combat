/**
 * Bardic Inspiration (SPEC §33): "once within the next hour, when the creature fails a d20 Test, it can roll the Bardic
 * Inspiration die and add the result, which can turn the failure into a success". The inspired creature carries the
 * "Inspired" effect of the bard's item (origin: the `bardic-inspiration` item); the die is the bard's scale
 * (`@scale.bard.inspiration`, d6 → d12).
 *
 * The engine offers it for the rolls it reads: an attack roll that misses a target, a failed saving throw — to the creature's
 * player (otherwise to the GM), before the verdict goes to the core (runtime/engine.mjs). The die is rolled openly, the effect
 * removed.
 */

import { MODULE_ID } from "../constants.mjs";
import { formulaShown } from "../core/formula-text.mjs";
import { originItemOf } from "./facts.mjs";
import { identifierOf, contentOf } from "./content.mjs";
import { askChoice } from "./choices.mjs";
import { combatantFor, readBudget, writeBudget } from "./turn.mjs";
import { inspirationOffer } from "../core/inspiration.mjs";
import { rerollFormula, rerollOffered, rerollQuestion } from "../core/reroll.mjs";

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Inspiration.${key}`, data ?? {});

/** A bard's Inspiration die (`@scale.bard.inspiration`, d6 → d12), "1d6" by default. */
export function inspirationDieOf(bard) {
  try {
    const die = Roll.replaceFormulaData("@scale.bard.inspiration", bard?.getRollData?.() ?? {}, { missing: "" }).trim();
    if ( /^\d*d\d+$/.test(die) ) return die.startsWith("d") ? `1${die}` : die;
  } catch { /* le d6 */ }
  return "1d6";
}

/** The inspiration the actor carries: the effect and the die formula; null if it has none. */
export function inspirationOf(actor) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( !item || (identifierOf(item).id !== "bardic-inspiration") ) continue;
    return { effect, formula: inspirationDieOf(item.actor), bard: item.actor?.name ?? "", source: item.actor ?? null };
  }
  return null;
}

/**
 * §113: what a bard can give — the Bardic Inspiration item, the activity that places the "Inspired" effect and its die, if it
 * has a use left; null otherwise.
 */
export function inspirationSourceOf(bard) {
  const item = bard?.items?.find(i => identifierOf(i).id === "bardic-inspiration");
  const activities = Array.from(item?.system?.activities ?? []);
  const activity = activities.find(a => a.effects?.length) ?? activities[0];
  if ( !activity || !(usesLeftFor(activity) > 0) ) return null;
  return { item, activity, formula: inspirationDieOf(bard) };
}

/**
 * The question (the creature's player, otherwise the GM), then the die: returns the result to add, or 0 (declined, no inspiration).
 * @param {Actor} actor
 * @param {{what: string, total: number, needed: number|null, test?: boolean}} context  The failed roll: "attack" or "save", its
 *   total, the threshold; `needed` null for a free check (§113), whose DC the engine does not know. §148: `test` — a check whose DC
 *   is known (carried by the roll): the question says so.
 */
export async function offerInspiration(actor, { what, total, needed, test=false, save=false, seconds=null }) {
  const inspiration = inspirationOf(actor);
  if ( !inspiration ) return 0;
  // §148: known threshold — nothing on a success, nor when even the die's highest result would not be enough (the die is
  // not wasted).
  let max = null;
  try { max = new Roll(inspiration.formula).evaluateSync({ maximize: true }).total; } catch { /* formule inconnue : on propose */ }
  const offer = inspirationOffer({ total, needed, max });
  if ( offer !== "offer" ) return 0;
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: t("Nom"),
    // §242: a requested saving throw, hidden DC — not "Check (…)".
    prompt: ((needed === null) && save) ? t("QuestionSave", { what, total, formula: inspiration.formula })
      : (needed === null) ? t("QuestionTest", { what, total, formula: inspiration.formula })
      : test ? t("QuestionDD", { what, total, needed, gap: needed - total, formula: inspiration.formula })
      : t("Question", { what, total, needed, formula: inspiration.formula }),
    // "No" first: with no answer within the timeout, askChoice takes the first option — the inspiration is not spent without
    // consent (user's choice on 2026-09-29, like Dark One's Own Luck).
    options: [{ id: "no", label: t("Non") }, { id: "yes", label: t("Oui", { formula: inspiration.formula }) }],
    ...(Number(seconds) > 0 ? { seconds } : {})
  });
  if ( answer?.id !== "yes" ) return 0;
  const roll = await new Roll(inspiration.formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: t("Carte", { name: actor.name, bard: inspiration.bard }) });
  await inspiration.effect.delete().catch(err => console.warn(`${MODULE_ID} | inspiration not removed`, err));
  return roll.total;
}

/**
 * §94: the activity roll's formula, read before it pays — "@consumed.hd" ("Symbiosis": "spend a Hit Die, roll it")
 * becomes the die that the consumption will spend (the largest or the smallest remaining). null if nothing to roll.
 */
function rollFormulaOf(activity) {
  let formula = activity?.roll?.formula;
  if ( !formula ) return null;
  if ( formula.includes("@consumed.hd") ) {
    const hd = activity.actor?.system?.attributes?.hd;
    const which = activity.consumption?.targets?.find(t => t.type === "hitDice")?.target;
    const die = (which === "smallest") ? hd?.smallestAvailable : hd?.largestAvailable;
    if ( !die || (die === "d0") ) return null;
    formula = formula.replaceAll("@consumed.hd", `1${die}`);
  }
  return formula;
}

/**
 * What is left to pay for the activity: the smallest number of remaining uses among those it consumes — of its item, or
 * of another (§90: maneuvers pay from Combat Superiority; dnd5e has already brought the target back to the id of the actor's
 * item, `_remapConsumptionTarget`). Infinity if nothing is counted.
 */
export function usesLeftFor(activity) {
  let left = Infinity;
  const count = item => (item && Number(item.system.uses?.max)) ? Math.max(0, Number(item.system.uses.value) || 0) : Infinity;
  for ( const t of activity?.consumption?.targets ?? [] ) {
    // §94: the uses of the activity itself ("Pull Yourself Together": once per Long Rest), the Hit Dice ("Symbiosis").
    if ( t.type === "activityUses" ) { if ( Number(activity.uses?.max) ) left = Math.min(left, Math.max(0, Number(activity.uses.value) || 0)); continue; }
    if ( t.type === "hitDice" ) { left = Math.min(left, Math.max(0, Number(activity.actor?.system?.attributes?.hd?.value) || 0)); continue; }
    if ( t.type !== "itemUses" ) continue;
    left = Math.min(left, count(t.target ? activity.actor?.items.get(t.target) : activity.item));
  }
  if ( left === Infinity ) left = count(activity?.item);
  return left;
}

/**
 * §38: a die that the creature adds to ITS OWN roll, after having seen it (content key `rollBonus: { activity, on, skills }` —
 * Dark One's Own Luck: "add 1d10 to your ability check or saving throw; after seeing the roll, before its effects; once
 * per roll"; §90: Precision Attack, Ambush, "Natural Authority", Tactical Assessment). Offered if enough is left to pay; yes:
 * the activity is used by dnd5e (its consumptions spent), its roll (`roll.formula`) rolled openly and returned. Returns the result
 * to add, or 0. `needed` absent (a check with no known DC): the question gives only the total.
 * @param {Actor} actor
 * @param {{kind: "save"|"check"|"attack"|"initiative", what: string, total: number, needed?: number, skill?: string,
 *   statuses?: string[]}} context  `statuses`: the conditions that the save avoids or ends (Survivor).
 */
/**
 * Gap survey (2026-10-22): Combat Inspiration (College of Valor 3) — "a creature that has a Bardic Inspiration die from
 * you can use it in these ways. Defense: when it is hit by an attack roll, it can take a Reaction to roll the die and
 * add the result to its AC against that attack, which can make it miss. Offense: just after hitting, it can roll the die
 * and add the result to the attack's damage." The actor's inspiration, if its bard has the feature (key `combatInspiration`).
 */
function combatInspirationOf(actor) {
  const inspiration = inspirationOf(actor);
  if ( !inspiration?.source?.items?.some?.(i => contentOf(i).entry?.combatInspiration === true) ) return null;
  return inspiration;
}

/** Could the creature defend itself with Combat Inspiration? (pre-check of the "hit" window, without the attack) */
export function hasCombatInspiration(actor) {
  return !!combatInspirationOf(actor);
}

/** The die rolled openly and the inspiration spent. */
async function spendCombatInspiration(actor, inspiration, key) {
  const roll = await new Roll(inspiration.formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: t(key, { name: actor.name, bard: inspiration.bard, total: roll.total }),
    flags: { [MODULE_ID]: { combatInspiration: { kind: key, total: roll.total } } } });
  await inspiration.effect.delete().catch(err => console.warn(`${MODULE_ID} | inspiration not removed`, err));
  return roll.total;
}

/**
 * Combat Inspiration, Offense: on the author's client, before the damage roll of a hit. Returns the die's result (added to
 * damage by runtime/feats.mjs), or 0.
 */
export async function offerCombatInspirationDamage(actor) {
  const inspiration = combatInspirationOf(actor);
  if ( !inspiration ) return 0;
  const answer = await askChoice(actor, { actor: actor.uuid, item: t("Nom"), prompt: t("VaillanceDegats", { formula: inspiration.formula }),
    options: [{ id: "no", label: t("Non") }, { id: "yes", label: t("Oui", { formula: inspiration.formula }) }] });
  return (answer?.id === "yes") ? spendCombatInspiration(actor, inspiration, "VaillanceCarteDegats") : 0;
}

/**
 * Combat Inspiration, Defense: the creature that was hit ("hit" window, runtime/reactions.mjs), if its Reaction is free, the
 * hit is not a Critical Hit and the die can make it miss. `auto`: the answer without a question (`autoReact: "first"`).
 * Returns the die, added to the AC to re-judge; 0 otherwise. The Reaction is spent.
 */
export async function offerCombatInspirationDefense(actor, { total, ac, critical=false, auto=false }) {
  const inspiration = critical ? null : combatInspirationOf(actor);
  if ( !inspiration || !Number.isFinite(total) || !Number.isFinite(ac) ) return 0;
  let max = Infinity;
  try { max = new Roll(inspiration.formula).evaluateSync({ maximize: true }).total; } catch { /* formule inconnue : on propose */ }
  if ( total >= ac + max ) return 0;
  const combatant = combatantFor(actor);
  if ( combatant && !((readBudget(combatant).reaction ?? 1) >= 1) ) return 0;
  if ( !auto ) {
    const answer = await askChoice(actor, { actor: actor.uuid, item: t("Nom"), prompt: t("VaillanceDefense", { total, ac, formula: inspiration.formula }),
      options: [{ id: "no", label: t("Non") }, { id: "yes", label: t("Oui", { formula: inspiration.formula }) }] });
    if ( answer?.id !== "yes" ) return 0;
  }
  if ( combatant ) { const budget = readBudget(combatant); await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1) }); }
  return spendCombatInspiration(actor, inspiration, "VaillanceCarteDefense");
}

/** §129: the kept d20 of a roll (the one that counts, after Advantage / Disadvantage), or null. */
export function keptD20(roll) {
  const die = roll?.dice?.find?.(d => d.faces === 20);
  const kept = die?.results?.filter(r => r.active && !r.discarded) ?? [];
  return (kept.length === 1) ? kept[0].result : null;
}

/** §280: the item uses that the activity cost are returned; the rule's item loses one (if it counts any). */
async function refundFailed(activity, item) {
  for ( const t of activity.consumption?.targets ?? [] ) {
    if ( t.type !== "itemUses" ) continue;
    // A target by identifier (DDB Importer data: "moxie") rather than by id.
    const paid = t.target ? (activity.actor?.items.get(t.target) ?? activity.actor?.items.find(i => identifierOf(i).id === t.target)) : activity.item;
    const spent = Number(paid?.system?.uses?.spent) || 0;
    if ( paid && spent ) await paid.update({ "system.uses.spent": Math.max(0, spent - (Number(t.value) || 1)) });
  }
  const uses = item.system?.uses;
  if ( Number(uses?.max) ) await item.update({ "system.uses.spent": Math.min(Number(uses.max), (Number(uses.spent) || 0) + 1) });
  console.log(`${MODULE_ID} | ${item.name}: still failed, cost refunded and the feature is spent`);
}

export async function offerRollBonus(actor, { kind, what, total, needed=null, skill=null, statuses=[], d20=null, ability=null,
  seconds=null, spell=false }) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.rollBonus;
    if ( !rule || !(rule.on ?? []).includes(kind) ) continue;
    // O6 (§342): a ring or a wondrous item works only when worn, and attuned if it requires it.
    if ( (item.type === "equipment") && ((item.system?.equipped === false) || ((item.system?.attunement === "required") && !item.system?.attuned)) ) continue;
    // Seeking spell: "if you make an attack roll for a spell and miss" — not a weapon attack.
    if ( rule.spellAttack && !((kind === "attack") && spell) ) continue;
    if ( (kind === "check") && rule.skills && !rule.skills.includes(skill) ) continue;
    if ( rule.statuses && !rule.statuses.some(s => statuses.includes(s)) ) continue;
    // §133: only a save of these abilities (Mage Slayer, Guarded Mind: Intelligence, Wisdom, Charisma).
    if ( rule.abilities && !rule.abilities.includes(ability) ) continue;
    const activity = item.system.activities?.get(rule.activity);
    // §133: `succeed` — the failed save becomes a success (Mage Slayer, Guarded Mind): what is added is the gap to the DC.
    if ( rule.succeed ) {
      const left = usesLeftFor(activity);
      if ( !activity || !Number.isFinite(needed) || (total >= needed) || !(left > 0) ) continue;
      const answer = await askChoice(actor, {
        actor: actor.uuid, item: item.name, ...(Number(seconds) > 0 ? { seconds } : {}),
        prompt: game.i18n.format("DND5ECOMBAT.EspritGarde.Question", { what, total, needed, item: item.name, left: Number.isFinite(left) ? left : "∞" }),
        options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.BonusJet.Non") }, { id: "yes", label: game.i18n.localize("DND5ECOMBAT.EspritGarde.Oui") }]
      });
      if ( answer?.id !== "yes" ) continue;
      const used = await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, { create: false }).catch(() => null);
      if ( !used ) return 0;
      await ChatMessage.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<p>${game.i18n.format("DND5ECOMBAT.EspritGarde.Carte", { item: item.name, name: actor.name, what })}</p>`,
        flags: { [MODULE_ID]: { rollBonus: { item: identifierOf(item).id, kind, added: needed - total, succeed: true } } } });
      return needed - total;
    }
    // Gap survey (2026-10-22): Fanatical Focus — "once per active Rage, if you fail a saving throw, you can reroll it
    // with a bonus equal to your Rage damage; you must use the new roll". What is added can be negative.
    // §280: without `during`, the rule's activity pays for the reroll ("Unshakeable": one Moxie point, a failed save).
    if ( rule.reroll && !rule.reroll.during ) {
      const left = usesLeftFor(activity);
      if ( !activity || !(left > 0) || !rerollOffered(rule.reroll, { d20, total, needed }) ) continue;
      const bonus = rule.reroll.bonus ?? "0";
      const fixed = Number.isInteger(rule.reroll.sets);
      const answer = await askChoice(actor, {
        actor: actor.uuid, item: item.name, ...(Number(seconds) > 0 ? { seconds } : {}),
        // The reroll that an activity pays for is not "once per Rage": its own question, which states the Advantage
        // if there is one.
        prompt: game.i18n.format(`DND5ECOMBAT.Relance.${rerollQuestion(rule.reroll, needed)}`,
          { what, total, needed, d20, bonus, item: item.name, sets: rule.reroll.sets }),
        options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.BonusJet.Non") },
          { id: "yes", label: fixed ? game.i18n.format("DND5ECOMBAT.Relance.OuiFixe", { sets: rule.reroll.sets })
            : game.i18n.localize("DND5ECOMBAT.Relance.Oui") }]
      });
      if ( answer?.id !== "yes" ) continue;
      const used = await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, { create: false }).catch(() => null);
      if ( !used ) return 0;
      // §298: an activity that consumes nothing in the data (Indomitable) — the use of its item is spent here.
      if ( !(activity.consumption?.targets ?? []).some(t => ["itemUses", "activityUses"].includes(t.type)) && Number(item.system.uses?.max) ) {
        await item.update({ "system.uses.spent": (Number(item.system.uses.spent) || 0) + 1 });
      }
      const roll = await new Roll(rerollFormula(rule.reroll), actor.getRollData()).evaluate();
      const added = roll.total - d20;
      await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
        flavor: game.i18n.format(`DND5ECOMBAT.Relance.${fixed ? "CarteFixe" : "Carte"}`,
          { item: item.name, name: actor.name, what, sum: total + added, sets: rule.reroll.sets }),
        flags: { [MODULE_ID]: { rollBonus: { item: identifierOf(item).id, kind, added, reroll: { old: d20, new: roll.total } } } } });
      return added;
    }
    if ( rule.reroll ) {
      const during = (actor.appliedEffects ?? actor.effects ?? []).find(e => !e.disabled && (identifierOf(originItemOf(e) ?? {}).id === rule.reroll.during));
      if ( !during || during.getFlag(MODULE_ID, "rerolled") || !Number.isInteger(d20) || !Number.isFinite(needed) || (total >= needed) ) continue;
      const answer = await askChoice(actor, {
        actor: actor.uuid, item: item.name, ...(Number(seconds) > 0 ? { seconds } : {}),
        prompt: game.i18n.format("DND5ECOMBAT.Relance.Question", { what, total, needed, d20, bonus: rule.reroll.bonus, item: item.name }),
        options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.BonusJet.Non") }, { id: "yes", label: game.i18n.localize("DND5ECOMBAT.Relance.Oui") }]
      });
      if ( answer?.id !== "yes" ) continue;
      await during.setFlag(MODULE_ID, "rerolled", true);
      const roll = await new Roll(`1d20 + ${rule.reroll.bonus}`, actor.getRollData()).evaluate();
      const added = roll.total - d20;
      await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
        flavor: game.i18n.format("DND5ECOMBAT.Relance.Carte", { item: item.name, name: actor.name, what, sum: total + added }),
        flags: { [MODULE_ID]: { rollBonus: { item: identifierOf(item).id, kind, added, reroll: { old: d20, new: roll.total } } } } });
      return added;
    }
    // §129: Lucky — the d20 rerolled, the better one kept: the d20 of the roll must be known.
    if ( rule.luck && !Number.isInteger(d20) ) continue;
    // §280: a "when you fail" die (Swagger) is not offered on a check that already succeeded, when the DC is known.
    if ( rule.failRefund && Number.isFinite(needed) && (total >= needed) ) continue;
    // The activity's formula, its references resolved: the question shows "1d10", not "@scale.bard.inspiration".
    const raw = rule.luck ? "1d20" : rollFormulaOf(activity);
    const formula = raw ? formulaShown(raw, activity?.getRollData?.() ?? actor.getRollData()) : raw;
    const left = usesLeftFor(activity);
    if ( !activity || !formula || !(left > 0) ) continue;
    // §94: a Reaction activity ("Symbiosis", "Pull Yourself Together") is offered only if the Reaction is free; it is spent.
    const reaction = activity.activation?.type === "reaction";
    const combatant = reaction ? combatantFor(actor) : null;
    if ( combatant && !((readBudget(combatant).reaction ?? 1) >= 1) ) continue;
    const shown = Number.isFinite(left) ? left : "∞";
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name,
      prompt: rule.luck ? game.i18n.format((needed === null) ? "DND5ECOMBAT.Chance.QuestionTest" : "DND5ECOMBAT.Chance.Question", { what, total, needed, d20, item: item.name, left: shown })
        : (needed === null) ? game.i18n.format("DND5ECOMBAT.BonusJet.QuestionTest", { what, total, formula, item: item.name, left: shown })
        : game.i18n.format("DND5ECOMBAT.BonusJet.Question", { what, total, needed, formula, item: item.name, left: shown }),
      // "Keep the roll" first: with no answer within the timeout, askChoice takes the first option — a use is not spent
      // without consent.
      options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.BonusJet.Non") },
        { id: "yes", label: rule.luck ? game.i18n.localize("DND5ECOMBAT.Chance.Oui") : game.i18n.format("DND5ECOMBAT.BonusJet.Oui", { formula }) }]
    });
    if ( answer?.id !== "yes" ) continue;
    // Activity uses with no maximum in the data ("Pull Yourself Together": "once per Long Rest", not numbered): dnd5e would
    // refuse the use for lack of something to pay with — nothing to count, it is done without consuming.
    const untracked = (activity.consumption?.targets ?? []).some(t => t.type === "activityUses") && !Number(activity.uses?.max);
    const used = await activity.use({ [MODULE_ID]: { confirmed: true }, ...(untracked ? { consume: false } : {}) }, { configure: false }, { create: false }).catch(() => null);
    if ( !used ) return 0;
    if ( combatant ) { const budget = readBudget(combatant); await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1) }); }
    const roll = await new Roll(formula, activity.getRollData?.() ?? actor.getRollData()).evaluate();
    // §129: Lucky — what is added is the gap between the new d20 and the old one, if it is better.
    const added = rule.luck ? Math.max(0, roll.total - d20) : roll.total;
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: rule.luck ? game.i18n.format("DND5ECOMBAT.Chance.Carte", { item: item.name, name: actor.name, what, old: d20, d20: roll.total, sum: total + added })
        : game.i18n.format("DND5ECOMBAT.BonusJet.CarteTotal", { item: item.name, name: actor.name, what, total, sum: total + roll.total }),
      flags: { [MODULE_ID]: { rollBonus: { item: identifierOf(item).id, kind, added, ...(rule.luck ? { luck: { old: d20, new: roll.total } } : {}) } } } });
    // §280: failed again (DC known) — what the activity cost is returned, and the item loses a use: "you regain the spent point
    // and cannot use this feature before a rest".
    if ( rule.failRefund && Number.isFinite(needed) && ((total + added) < needed) ) await refundFailed(activity, item);
    return added;
  }
  return 0;
}
