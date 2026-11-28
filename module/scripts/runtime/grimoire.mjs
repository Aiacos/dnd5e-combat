/**
 * §139: the Wizard's spellbook — rituals and Arcane Recovery.
 *  - Ritual (`dnd5e.preUseActivity`, on the client of the caster): out of combat, a spell with the Ritual tag is cast without a
 *    spell slot (`consume.spellSlot: false`, documents/activity/mixin.mjs) when it can only be cast as a ritual (not prepared with
 *    Ritual Adept, or no slot left); prepared with a slot, the player chooses — the use is suspended then relaunched
 *    with their answer, like the gates (runtime/gates.mjs).
 *  - Arcane Recovery (`dnd5e.restCompleted`, on the client that started the Short Rest): the player designates the slots to
 *    recover, level by level, within the rule's limit; one use of the item is spent.
 */

import { MODULE_ID } from "../constants.mjs";
import { recoveryBudget, recoverableLevels } from "../core/grimoire.mjs";
import { ritualModeOf, slotRecoveryOf } from "../adapter/grimoire.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";
import { spendItemUses } from "../adapter/uses.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { comesFromItemEffect, originItemOf } from "../adapter/facts.mjs";
import { relaunchUse } from "./relaunch.mjs";

const tokenOfActor = actor => actor?.getActiveTokens?.(false, true)?.[0] ?? null;

/**
 * As a ritual: without a slot, at the spell's level. The use window stays what the settings make of it: a ritual that summons
 * (Find Familiar) chooses its form there.
 */
function asRitual(activity, usageConfig) {
  usageConfig.consume = { ...((usageConfig.consume && (typeof usageConfig.consume === "object")) ? usageConfig.consume : {}), spellSlot: false };
  usageConfig.scaling = 0;
  usageConfig[MODULE_ID] = { ...(usageConfig[MODULE_ID] ?? {}), ritual: "ritual" };
  notice(tokenOfActor(activity.actor), loc("Rituel.Lance", { item: activity.item.name }), "gain");
  log(`${activity.actor.name}: ${activity.item.name} cast as a Ritual (no spell slot, +10 minutes)`);
}

function onPreUse(activity, usageConfig, dialogConfig, messageConfig) {
  const ours = usageConfig?.[MODULE_ID] ?? {};
  if ( ours.ritual === "slot" ) return true;
  const mode = (ours.ritual === "ritual") ? "ritual" : ritualModeOf(activity);
  if ( mode === "none" ) return true;
  if ( mode === "ritual" ) {
    asRitual(activity, usageConfig);
    return true;
  }
  // Prepared, a slot remains: ritual or slot, up to the player; closed without choosing, nothing is cast.
  (async () => {
    const answer = await askChoice(activity.actor, {
      actor: activity.actor.uuid, item: activity.item.name, untimed: true,
      prompt: loc("Rituel.Question", { item: activity.item.name }),
      options: [{ id: "ritual", label: loc("Rituel.EnRituel") }, { id: "slot", label: loc("Rituel.AvecEmplacement") }]
    });
    if ( !answer ) return;
    const { subsequentActions, ...rest } = usageConfig;
    await relaunchUse(activity, { ...rest, [MODULE_ID]: { ...ours, ritual: answer.id } }, dialogConfig, messageConfig);
  })().catch(err => console.error(`${MODULE_ID} | ritual choice`, err));
  return false;
}

/**
 * C12-j: `regainOnShortRest` — the uses of these items (identifiers) all come back on a Short Rest (Font of Inspiration:
 * Bardic Inspiration; Improved Warding Flare: Warding Flare), where the data only restores them on a Long Rest.
 */
async function shortRestRegain(actor, result, config) {
  if ( (config?.type !== "short") || !actor?.isOwner ) return;
  const ids = new Set(Array.from(actor.items).flatMap(i => contentOf(i).entry?.regainOnShortRest ?? []));
  if ( !ids.size ) return;
  for ( const item of actor.items ) {
    if ( !ids.has(identifierOf(item).id) || !(Number(item.system?.uses?.spent) > 0) ) continue;
    await item.update({ "system.uses.spent": 0 });
    log(`${actor.name}: ${item.name} regained on a Short Rest`);
  }
}

/**
 * §402: `fadesOnLongRest: [ids d'effets]` — at each Long Rest, the bearer loses one of these effects of the item, the first
 * present in the list order (Raise Dead, Resurrection: "the penalty is reduced by 1 each Long Rest" — four effects of −1).
 */
async function longRestFade(actor, result, config) {
  if ( (config?.type !== "long") || !actor?.isOwner ) return;
  const byItem = new Map();
  for ( const effect of actor.effects ) {
    const item = originItemOf(effect);
    const ids = item ? contentOf(item).entry?.fadesOnLongRest : null;
    const rank = ids?.findIndex(id => comesFromItemEffect(effect, id)) ?? -1;
    if ( rank < 0 ) continue;
    const best = byItem.get(item);
    if ( !best || (rank < best.rank) ) byItem.set(item, { effect, rank });
  }
  for ( const [item, { effect }] of byItem ) {
    const name = effect.name;
    await effect.delete();
    notice(tokenOfActor(actor), loc("Retour.Estompe", { item: item.name }), "gain");
    log(`${actor.name}: ${name} fades after a Long Rest (${item.name})`);
  }
}

async function onRestCompleted(actor, result, config) {
  if ( (config?.type !== "short") || !actor?.isOwner ) return;
  const recovery = slotRecoveryOf(actor);
  if ( !recovery ) return;
  const { item, rule, classLevel, counter } = recovery;
  const slots = foundry.utils.deepClone(recovery.slots);
  let budget = recoveryBudget(classLevel);
  const taken = [];
  for ( ;; ) {
    const levels = recoverableLevels(slots, budget, rule.maxLevel ?? 5);
    if ( !levels.length ) break;
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, untimed: true,
      prompt: loc("Restauration.Question", { item: item.name, left: budget }),
      options: [...levels.map(level => ({ id: String(level), label: loc("Restauration.Niveau", { level }) })),
        { id: "done", label: loc(taken.length ? "Restauration.Fini" : "Restauration.Aucun") }]
    });
    const level = Number(answer?.id);
    if ( !level ) break;
    slots[level].value += 1;
    budget -= level;
    taken.push(level);
  }
  if ( !taken.length ) return;
  const updates = Object.fromEntries([...new Set(taken)].map(level => [`system.spells.spell${level}.value`, slots[level].value]));
  await actor.update(updates);
  // The use is spent where it is counted: the activity named by the rule ("Replenishment"), otherwise the item.
  if ( counter === "activity" ) {
    const spent = Number(item.system.activities.get(rule.activity)?.uses?.spent) || 0;
    await item.update({ [`system.activities.${rule.activity}.uses.spent`]: spent + 1 });
  }
  else if ( counter === "item" ) await spendItemUses(item);
  const text = loc("Restauration.Faite", { item: item.name, levels: taken.sort((a, b) => a - b).join(", ") });
  notice(tokenOfActor(actor), text, "gain");
  log(`${actor.name}: ${item.name}, spell slots recovered (levels ${taken.join(", ")})`);
}

export function registerGrimoire() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "Ritual: cast without a spell slot" });
  // On the client that started the rest (documents/actor/actor.mjs): owner of the actor; the question goes to its player.
  route("dnd5e.restCompleted", onRestCompleted, { label: "Arcane Recovery not offered" });
  route("dnd5e.restCompleted", shortRestRegain, { label: "uses not regained on a Short Rest" });
  route("dnd5e.restCompleted", longRestFade, { label: "effect not faded on a Long Rest" });
}
