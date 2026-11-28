/**
 * K1 to K12 (SPEC §322–§334): the "text" layer of an NPC ability, assembled from the readers of `core/monster-text.mjs`.
 * Moved out of `adapter/content.mjs` (`textLayer`) on 2026-11-15 (§460) so that the ATLAS (`tools/atlas.mjs`) computes exactly
 * what the engine plays on a creature, without Foundry: the adapter gives it the live item, the ATLAS the raw compendium data.
 *
 * Pure: plain strings and objects.
 */

import { monsterChoice, monsterDeaths, monsterEndings, monsterPushes, monsterReactions, monsterRecurring, monsterTypeGate, monsterAdvantage,
  monsterSaveDamage, monsterMissingStatus, monsterNoOpportunity, monsterBasicActions, monsterSightGate, monsterImmunity, monsterEffectDurations,
  monsterReactionWindow, monsterActivationAdvantage, monsterDefense, monsterChargeGate, monsterLightSensitivity, monsterSelfTeleport,
  monsterBreaksOn, monsterLightChecks, monsterBloodiedSaves,
  monsterTeleportChoice } from "./monster-text.mjs";
import { readDrain, drains } from "./drain.mjs";

/**
 * The text layer of an NPC ability, or null if the text says nothing about it.
 * @param {object} input
 * @param {string} input.html                 The original English text (raw HTML, enrichers included).
 * @param {string|null} [input.identifier]    The engine's identifier.
 * @param {Array<{id: string, name?: string, type?: string, activation?: {type?: string, condition?: string}, effects?: string[],
 *   onSave?: string|null, range?: {value?: *, units?: string, special?: string}, template?: boolean,
 *   target?: {type?: string, count?: *, special?: string}}>} [input.activities]  The activities, in the item's order.
 * @param {Array<{id: string, statuses?: string[], changes?: Array<{key: string, value: *}>}>} [input.effects]  The item's effects.
 * @param {boolean} [input.swallow]           The shipped content declares the Swallow brick (its recurring damage is not re-read).
 * @returns {object|null}
 */
export function monsterTextLayer({ html, identifier=null, activities=[], effects=[], swallow=false }) {
  if ( !html ) return null;
  const fx = effects.map(e => ({ id: e.id, statuses: [...(e.statuses ?? [])] }));
  const named = activities.map(a => ({ id: a.id, name: a.name ?? "" }));
  const triggers = monsterEndings(html, fx);
  // K2 (§323): death at 0 HP and the HP tiers that the text promises.
  const deaths = monsterDeaths(html, { activities: named, effects: fx });
  // K3 (§324): only one of the effects — drawn by die or chosen by the creature.
  const choice = monsterChoice(html, fx);
  // K6 (§327): parry ("adds N to its AC"), lost Reactions, action OR Bonus Action.
  const acEffect = effects.flatMap(e => e.changes ?? []).find(c => c.key === "system.attributes.ac.bonus" && /^\+?\d+$/.test(String(c.value).trim()));
  const reacts = monsterReactions(html, { reaction: activities.some(a => a.activation?.type === "reaction"),
    acEffect: acEffect ? Number(String(acEffect.value).replace("+", "")) : null });
  // K7 (§328): recurring damage to the bearer, blocked healing, absorption — not for an ability the Swallow brick already plays.
  const recurring = monsterRecurring(html, fx, activities.map(a => ({ id: a.id, type: a.type })));
  if ( swallow ) delete recurring.triggers;
  // K8 (§329): pushes and pulls read from the text.
  const pushes = monsterPushes(html, { save: activities.some(a => a.type === "save"), attack: activities.some(a => a.type === "attack"),
    area: activities.some(a => a.template) });
  // K10 (§331): conditional Advantage read from the text; §334: the one given by an attack's activation condition.
  const advantage = monsterAdvantage(html, identifier);
  advantage.push(...monsterActivationAdvantage(activities.filter(a => a.type === "attack").map(a => a.activation?.condition ?? ""), identifier));
  // K12 (§333): the condition that the data forgets to apply; §334: a condition read with its one-turn duration gets it through
  // `effectEnds` "status:<condition>".
  const acts = activities.map(a => ({ id: a.id, type: a.type, effects: a.effects ?? [] }));
  const missing = monsterMissingStatus(html, { activities: acts, effects: fx }).map(({ ends, ...t }) => {
    if ( ends ) (recurring.effectEnds ??= {})[`status:${t.do[0].status}`] = ends;
    return t;
  });
  // K1 (§334): temporary Immunity after a success.
  const immunity = monsterImmunity(html, identifier, acts);
  if ( immunity ) missing.push(immunity.trigger);
  // §334: the window of a monster Reaction from its trigger, when K6's parry gives none.
  const reactive = activities.filter(a => a.activation?.type === "reaction");
  const reactionConditions = reactive.map(a => a.activation?.condition ?? "");
  const outward = reactive.some(a => ["save", "attack", "damage"].includes(a.type));
  const window = (reactionConditions.length && !reacts.triggers?.length) ? monsterReactionWindow(html, reactionConditions, outward, reactive[0]?.id ?? null) : [];
  const allTriggers = [...triggers, ...monsterDefense(html), ...monsterLightSensitivity(html), ...(reacts.triggers ?? []), ...window, ...(recurring.triggers ?? []),
    ...pushes, ...advantage, ...missing];
  // §334: the durations in turns that the text gives to effects, lost Reactions and healing blocked per effect.
  const durations = monsterEffectDurations(html, { activities: acts, effects: fx });
  if ( durations.effectEnds ) recurring.effectEnds = { ...durations.effectEnds, ...(recurring.effectEnds ?? {}) };
  if ( durations.noReactions && !reacts.noReactions ) recurring.noReactions = durations.noReactions;
  if ( durations.blocksHealing && !recurring.blocksHealing ) recurring.blocksHealing = durations.blocksHealing;
  const { triggers: _r, ...recurringRest } = recurring;
  const { triggers: _t, ...restrictions } = reacts;
  // K11 (§332): no half damage on a success when the text gives none.
  const saveDamage = monsterSaveDamage(html, activities.map(a => ({ id: a.id, type: a.type, onSave: a.onSave ?? null })));
  if ( saveDamage ) recurringRest.saveDamage = saveDamage;
  // §334: the attack's condition comes only after a charge ("moved 20+ feet straight toward it immediately before the hit").
  const charge = monsterChargeGate(html, acts);
  if ( charge ) recurringRest.effectsIf = charge;
  // K12 (§333): no more Opportunity Attack, Dash / Disengage / Hide, max HP drain stated by the text.
  if ( monsterNoOpportunity(html, fx) ) recurringRest.noOpportunityAttacks = true;
  // §334: "moves up to (half) its Speed without provoking Opportunity Attacks" — the rest of the turn without Opportunity Attacks.
  if ( /\bmoves? up to (?:half )?its (?:\w+ )?Speed without provoking\b/i.test(html.replace(/<[^>]+>/g, " ").replace(/&Reference\[([^\]]*)\]/g, "$1")) ) recurringRest.noOpportunity = "afterUse";
  // The ability's effects end when its bearer makes an attack roll, if its text says so (Will-o'-Wisp's Vanish).
  const breaks = monsterBreaksOn(html);
  if ( breaks && fx.length ) recurringRest.breaksOn = breaks;
  // §484: "in sunlight, Disadvantage on ability checks" — the half of the sentence that triggers do not carry.
  const lightChecks = monsterLightChecks(html);
  if ( lightChecks ) recurringRest.rollDisadvantage = lightChecks;
  // "while Bloodied, Advantage on attack rolls and saving throws" — the half the triggers do not carry.
  const bloodiedSaves = monsterBloodiedSaves(html);
  if ( bloodiedSaves ) recurringRest.rollAdvantage = bloodiedSaves;
  const basics = monsterBasicActions(html, acts);
  if ( basics ) recurringRest.basicActions = basics;
  if ( drains(readDrain(html)) ) recurringRest.drain = true;
  // K9 (§330): type gate ("Constructs and Undead succeed automatically"); K12 (§333): "that can see the X".
  const typeGate = monsterTypeGate(html);
  const sight = monsterSightGate(html, acts);
  const gates = [typeGate?.unaffectedIf, sight, immunity?.gate].filter(Boolean);
  const gate = gates.length ? { unaffectedIf: (gates.length > 1) ? { any: gates } : gates[0] } : null;
  // §461: self-teleportation, within the activity's range (Demon Teleportation, Fey Step of spirits…).
  const teleport = monsterSelfTeleport(html, activities);
  if ( teleport ) recurringRest.teleport = teleport;
  // §463: an arrival area "of its choice" — the creature spares whom it wants (enemies ticked in advance).
  if ( (teleport?.area === "arrival") && monsterTeleportChoice(html) ) recurringRest.zoneAffects = "enemy";
  return (allTriggers.length || Object.keys(deaths).length || choice || Object.keys(restrictions).length || Object.keys(recurringRest).length || gate)
    ? { ...(allTriggers.length ? { triggers: allTriggers } : {}), ...deaths, ...restrictions, ...recurringRest, ...(choice ? { choice } : {}), ...(gate ? { targets: gate } : {}) } : null;
}
