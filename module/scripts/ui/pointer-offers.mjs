/**
 * After an action: targets released, and the offers that reopen an aim (Cleave, Flurry of Blows, enchanted attack,
 * Bounce, Bonus Action attack), end of turn. Extracted from ui/pointer.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { combatantFor, isOwnTurn, readBudget } from "../adapter/turn.mjs";
import { stormOf } from "../adapter/storm.mjs";
import { strike } from "../runtime/storm.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { leapOf, rolledDouble, evalRuleFormula } from "../adapter/projectiles.mjs";
import { teleportSelf, selfTeleportOf } from "../runtime/actions.mjs";
import { masteryOf, cleaveCandidates, cleaveSpent } from "../adapter/mastery.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { loc, log } from "../runtime/shared.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { openTargeting, reticle, setting, stormAfterUse } from "./pointer.mjs";
import { offerChainedPick } from "./pick-targets.mjs";

/* -------------------------------------------- */
/*  Targets released                            */
/* -------------------------------------------- */

function releaseTargets() {
  inFlight = null;
  if ( !setting("releaseTargets") ) return;
  clearTargets();
}

export function clearTargets() {
  for ( const token of Array.from(game.user.targets) ) token.setTarget(false, { releaseOthers: false });
}

/**
 * §125: the targets that an action launched by the engine carries (`{ activity, ids }`), until their release at the end of its
 * resolution. Another activity launched in the meantime on exactly these targets inherited them: these are leftovers.
 */
let inFlight = null;
const targetIds = () => Array.from(game.user.targets).map(t => t.document.uuid).sort();
export function noteInFlight(activity) {
  const ids = targetIds();
  inFlight = ids.length ? { activity: activity?.uuid ?? null, ids } : null;
}
export function leftoverTargets(activity) {
  if ( !inFlight || !game.user.targets.size || (inFlight.activity === (activity?.uuid ?? null)) ) return false;
  const ids = targetIds();
  return (ids.length === inFlight.ids.length) && ids.every((id, i) => id === inFlight.ids[i]);
}

/**
 * An action judged (attack hit and damage applied, missed, saves settled): its author releases their targets. `released`:
 * the messages already handled, bounded to the most recent (a long session does not keep them all).
 */
const released = new Set();
const RELEASED_KEPT = 200;
export function onResolutionSettled(message) {
  if ( !message.author?.isSelf || released.has(message.id) ) return;
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !["done", "missed"].includes(resolution?.step) ) return;
  released.add(message.id);
  if ( released.size > RELEASED_KEPT ) released.delete(released.values().next().value);
  releaseTargets();
  if ( resolution.step === "done" ) offerBonusAttack(message, resolution);
  if ( resolution.step === "done" ) offerCleave(message, resolution);
  if ( message.getFlag(MODULE_ID, "flurry") ) offerFlurry(message.getAssociatedActor?.());
  if ( resolution.step === "done" ) offerLeap(message, resolution);
  offerTeleportAfterAttack(message, resolution);
}

/**
 * §464: "right after the attack hits or misses, the spirit can teleport up to 9 m" (Yugoloth spirit's mind claws) — once the
 * attack is judged, the teleportation aim opens for its author (Esc: stay). The validation, the forceable refusal and the return
 * for the table are those of any self-teleportation (runtime/teleport.mjs).
 */
function offerTeleportAfterAttack(message, resolution) {
  if ( !resolution.plan?.attack || !setting("teleportPlanning") ) return;
  const activity = message.getAssociatedActivity?.();
  const rule = (activity?.type === "attack") ? selfTeleportOf(activity) : null;
  if ( rule?.after !== "attack" ) return;
  const token = activity.getUsageToken?.() ?? null;
  if ( !token?.object ) return;
  const units = token.parent.grid.units;
  const distance = Math.round(lengthIn(rule.distance, rule.units, units) * 10) / 10;
  ui.notifications.info(loc("Teleport.Apres", { name: token.name, item: activity.item.name, distance, units }));
  log(`${activity.item.name}: teleport offered after the attack (${distance} ${units})`);
  teleportSelf(activity).catch(err => console.error(`${MODULE_ID} | teleport after attack`, err));
}

/**
 * §21: Cleave (mastery property) — the melee attack hit and the roll carried the mastery property: the aim opens for the
 * author for a second attack with the same weapon, at no cost, against a creature within 1,50 m of the first and within reach.
 * Once per combat turn. Right click to give up.
 */
function offerCleave(message, resolution) {
  if ( !resolution.plan?.attack || message.getFlag(MODULE_ID, "cleave") ) return;
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  if ( masteryOf(attackMessage) !== "cleave" ) return;
  const activity = message.getAssociatedActivity?.();
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || cleaveSpent(actor) ) return;
  const mode = attackMessage.rolls?.[0]?.options?.attackMode ?? "";
  if ( (activity.attack?.type?.value !== "melee") || mode.includes("thrown") || (mode === "ranged") ) return;
  const hit = resolution.targets.find(t => t.hit);
  const first = hit ? fromUuidSync(hit.token, { strict: false }) : null;
  const { scene, token: tokenId } = attackMessage.speaker ?? {};
  const token = game.scenes.get(scene)?.tokens.get(tokenId) ?? null;
  if ( !first || !token?.object || !cleaveCandidates(token, first, activity).length ) return;
  openTargeting(token, activity, [{ [MODULE_ID]: { cost: "free", cleave: first.uuid } }, { configure: false }, {}],
    { prompt: loc("Botte.Enchainement.Visee", { item: activity.item.name, name: first.name }),
      notice: loc("Botte.Retour.cleave"), reticle: loc("Botte.Retour.cleave") });
}

/**
 * §24: Flurry of Blows — as long as free strikes remain in the turn's budget, the unarmed strike's aim opens for
 * the author: after the Flurry's activation, then after each resolved strike. Right click to give up.
 */
function offerFlurry(actor) {
  const combatant = actor ? combatantFor(actor) : null;
  if ( !combatant || !isOwnTurn(combatant) || !((readBudget(combatant)?.flurry ?? 0) > 0) ) return;
  // §27: War Priest — the attack opened is made with the equipped melee weapon, otherwise unarmed.
  const weapon = readBudget(combatant).flurryAny
    ? actor.items.find(i => (i.type === "weapon") && i.system.equipped && (identifierOf(i).id !== "unarmed-strike")) : null;
  const strike = weapon ?? actor.items.find(i => (i.type === "weapon") && (identifierOf(i).id === "unarmed-strike"));
  const activity = strike?.system.activities?.find(a => a.type === "attack");
  const token = combatant.token;
  if ( !activity || !token?.object ) return;
  const label = weapon ? "Clerc.PretreGuerre" : "Moine.Deluge";
  openTargeting(token, activity, [{}, { configure: false }, {}],
    { prompt: loc(`${label}.Visee`, { n: readBudget(combatant).flurry }), notice: loc(`${label}.Retour`), reticle: loc(`${label}.Retour`) });
}

/** §24: the activation of Flurry of Blows (the author's use card): the first strike is aimed at once, budget written. */
export function onFlurryUsed(message) {
  if ( (message.type !== "usage") || !message.author?.isSelf ) return;
  const activity = message.getAssociatedActivity?.();
  const rule = activity?.item ? contentOf(activity.item).entry?.flurry : null;
  if ( !rule || ![rule.activity].flat().includes(activity.id) ) return;
  // The budget is written by the active GM right after the card: it is given a moment.
  setTimeout(() => offerFlurry(activity.actor), 800);
}

/**
 * §23: True Strike — "you make an attack with the weapon used to cast the spell": as soon as the enchantment (content
 * `oneAttack`) is placed on the weapon, the aim of its attack opens for whoever plays the creature (the connected player, otherwise
 * the active GM), at no cost — the spell paid the action. The enchantment drops after the attack (runtime/cantrips.mjs).
 */
export function offerEnchantedAttack(effect) {
  const weapon = effect.parent;
  const actor = weapon?.actor;
  if ( (weapon?.documentName !== "Item") || (weapon.type !== "weapon") || !actor ) return;
  if ( contentOf(originItemOf(effect)).entry?.oneAttack !== true ) return;
  if ( (rollerFor(actor) ?? game.users.activeGM?.id) !== game.user.id ) return;
  const activity = weapon.system.activities?.find(a => a.type === "attack");
  const token = actor.getActiveTokens(true, true)?.[0] ?? null;
  if ( !activity || !token?.object ) return;
  openTargeting(token, activity, [{ [MODULE_ID]: { cost: "free" } }, { configure: false }, {}],
    { prompt: loc("Visee.AttaqueEnchantee", { item: weapon.name }), notice: weapon.name, reticle: weapon.name });
}

/**
 * §16.27: Chromatic Orb — the attack hit and the damage dice show a double: the aim opens for the author to
 * make the orb bounce (same activity, no slot or action, same damage type, at the casting level). The target is
 * validated at use (runtime/projectiles.mjs): within 9 m of the last one, never aimed. Right click to give up.
 */
function offerLeap(message, resolution) {
  if ( !resolution.plan?.attack ) return;
  const hit = resolution.targets.find(t => t.hit);
  if ( !hit ) return;
  const usage = game.messages.get(resolution.origin ?? message.id) ?? message;
  const activity = usage.getAssociatedActivity?.();
  const rule = leapOf(activity?.item);
  if ( !rule || !rolledDouble(game.messages.get(resolution.damageRoll?.messageId ?? "")) ) return;
  const prior = usage.getFlag(MODULE_ID, "leap");
  const first = prior?.of ? (game.messages.get(prior.of) ?? usage) : usage;
  const left = prior ? prior.left : evalRuleFormula(rule.max, first.getAssociatedActivity?.({ scaled: true }), 1);
  if ( !(left > 0) ) return;
  const token = activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token?.object ) return;
  const level = activity.item.system.level ?? 0;
  const scaling = Number(first.system?.scaling) || 0;
  const leap = { of: first.id, from: hit.token, chain: [...(prior?.chain ?? []), ...resolution.targets.map(t => t.token)], left: left - 1 };
  const config = {
    consume: { spellSlot: false }, concentration: { begin: false },
    ...(level > 0 ? { scaling, spell: { slot: `spell${level + scaling}` } } : {}),
    [MODULE_ID]: { cost: "free", leap }
  };
  const damageType = usage.getFlag(MODULE_ID, "damageType");
  const flags = { leap, ...(damageType ? { damageType } : {}) };
  log(`${activity.item.name}: doubles on the dice, leap offered (${left} left)`);
  openTargeting(token, activity, [config, { configure: false }, { data: { flags: { [MODULE_ID]: flags } } }],
    { prompt: loc("Rebond.Visee", { item: activity.item.name, left }), notice: loc("Retour.Rebond"), noticeOn: hit.token,
      reticle: loc("Retour.Rebond") });
}

/**
 * §16.26: Hew (Great Weapon Master) — after a Critical Hit, or a creature dropped to 0 HP, with a weapon (melee
 * if the rule says so), on the author's client: the aim opens to attack again with the same weapon, for the
 * Bonus Action (`cost: "bonus"`, which legality and the budget read). On their turn, in combat, the Bonus Action still there;
 * right click to give up.
 */
function offerBonusAttack(message, resolution) {
  if ( !resolution.plan?.attack ) return;
  const activity = message.getAssociatedActivity?.();
  const actor = activity?.actor;
  if ( !actor || (activity.item?.type !== "weapon") || (activity.type !== "attack") ) return;
  const critical = resolution.targets.some(t => t.hit && t.critical);
  const felled = (resolution.log ?? []).some(l => (l.at === "applyDamage") && !l.kind && (l.before?.value > 0) && (l.after?.value === 0));
  const attackMode = game.messages.get(resolution.attack?.messageId ?? "")?.rolls?.[0]?.options?.attackMode ?? "";
  const melee = (activity.attack?.type?.value === "melee") && !attackMode.includes("thrown") && (attackMode !== "ranged");
  const rule = actor.items.map(i => contentOf(i).entry?.bonusAttack).find(r => r
    && ((critical && r.after.includes("critical")) || (felled && r.after.includes("felled"))) && (!r.melee || melee));
  if ( !rule ) return;
  const combatant = combatantFor(actor);
  if ( !combatant || !isOwnTurn(combatant) || !(readBudget(combatant)?.bonus > 0) ) return;
  const token = combatant.token;
  if ( !token?.object ) return;
  openTargeting(token, activity, [{ [MODULE_ID]: { cost: "bonus" } }, { configure: false }, {}],
    { prompt: loc("Visee.AttaqueBonus", { item: activity.item.name, why: loc(critical ? "Visee.Critique" : "Visee.Abattu") }),
      notice: loc("Retour.Taille"), reticle: loc("Retour.Taille") });
}

/** End of turn: whoever played this combatant releases their targets. */
export function onTurnChange(combat, prior) {
  const combatant = combat.combatants.get(prior?.combatantId);
  if ( !combatant?.isOwner || (game.user.isGM && combatant.hasPlayerOwner) ) return;
  releaseTargets();
}

/* -------------------------------------------- */

/**
 * §16.10: a self-teleportation (native "teleport" activity at "self" range, or an item that declares it: Misty
 * Step, Dimension Door) opens the destination aim as soon as it is used, on the client of whoever used
 * it — the TODO of dnd5e 6 (`_triggerSubsequentActions`, teleport.mjs).
 */
export function onPostUseActivity(activity, usageConfig, results) {
  // §438: the save that follows a manifestation (Wrath of the Sea 3.0.0), under the same action.
  if ( results ) offerChainedPick(activity, results).catch(err => console.error(`${MODULE_ID} | chained choice`, err));
  if ( results && stormOf(activity?.item) ) return void stormAfterUse(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | storm`, err));
  // §464: a teleportation "after the attack" waits for the attack to be judged (`offerTeleportAfterAttack`).
  if ( !results || !setting("teleportPlanning") || !selfTeleportOf(activity) || selfTeleportOf(activity).after ) return;
  if ( usageConfig?.subsequentActions === false ) return;   // a caller that chains by itself (connector, scenarios)
  teleportSelf(activity).catch(err => console.error(`${MODULE_ID} | teleportation`, err));
}

/**
 * §16.34: attack, damage and healing rolls go off without dnd5e's configuration window (per-player setting,
 * on by default) — those that dnd5e chains after the use (activity/attack.mjs:69, heal.mjs:61, damage.mjs:52), from
 * the sheet, the HUD or the card button. Advantage and Disadvantage come from the engine; the attack mode ("throw") is
 * preselected by runtime/turn.mjs.
 * #173 (§556): it also covers the damage the engine rolls itself (adapter/messages.mjs), which offers dnd5e's dialog —
 * except when the world's "Damage and healing" setting asks the author to roll (`dialog: "required"`): the dialog then
 * shows anyway.
 */
export function onPreRollDamage(config, dialog) {
  if ( config?.[MODULE_ID]?.dialog === "required" ) return;
  if ( dialog && setting("quickRolls") ) dialog.configure = false;
}
