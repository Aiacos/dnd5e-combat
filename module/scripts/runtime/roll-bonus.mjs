/**
 * §90: a die the creature adds to a check it just rolled, or to its Initiative (`rollBonus` key, `on: ["check"]` /
 * `["initiative"]`) — Ambush (Stealth, Initiative), Natural Authority (Intimidation, Performance, Persuasion), Tactical
 * Assessment (History, Investigation, Insight) of the Battle Master; the Dark One's Own Luck on a check. §113: then the bardic
 * Inspiration the creature carries (`offerInspiration`, no threshold).
 *
 * The engine does not know the DC of a free check: the question is asked as soon as the roll is made ("after seeing it"),
 * on the client that rolled it, to the creature's player (adapter/inspiration.mjs, `offerRollBonus`); the die goes out in the
 * open, with the new total on its card — the original roll is not rewritten. Initiative, though, is corrected: the first value
 * a combatant receives (on the active GM) opens the question, and the die is added to its value.
 *
 * §120: Hypervigilance (Survivor, `rerollInitiative` key) — the d20 of an Initiative roll of 9 or less is rerolled, the new one
 * kept. The core writes the Initiative THEN creates the roll card (client/documents/combat.mjs:432-435,
 * `flags.core.initiativeRoll`): the active GM reads the d20 on the card, asks the player (otherwise the GM) whether to reroll
 * — with no answer, the roll is kept —, rerolls, and corrects the Initiative by the difference. The Ambush die is also added to
 * the value in force at the moment of writing it: the two corrections stack in any order.
 */

import { d20Keep } from "../core/d20.mjs";
import { MODULE_ID } from "../constants.mjs";
import { offerInspiration, offerRollBonus, keptD20 } from "../adapter/inspiration.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { initiativeReroll, rerolledInitiative } from "../core/initiative.mjs";
import { swapPartners } from "../core/feats.mjs";
import { initiativeRegain } from "../core/self-care.mjs";
import { enqueue } from "./queue.mjs";
import { heroicAfter } from "./heroic.mjs";
import { route } from "./router.mjs";
import { log, say, locEsc } from "./shared.mjs";
import { sideOf } from "../adapter/factions.mjs";

/** The check's name: the skill, the tool or the ability. */
function checkName({ skill, tool, ability }) {
  if ( skill ) return CONFIG.DND5E.skills?.[skill]?.label ?? skill;
  if ( tool ) return CONFIG.DND5E.tools?.[tool]?.label ?? game.i18n.localize("DND5E.ToolCheck");
  return CONFIG.DND5E.abilities?.[ability]?.label ?? ability ?? "";
}

async function onCheckRolled(rolls, { skill=null, tool=null, ability=null, subject }={}) {
  const actor = subject;
  const total = rolls?.[0]?.total;
  if ( !actor?.isOwner || !Number.isFinite(total) ) return;
  // §242: a roll requested by the GM — its dice after the roll go through the request, which counts them (runtime/group-roll.mjs).
  if ( rolls[0].options?.[MODULE_ID]?.groupRoll ) return;
  const what = checkName({ skill, tool, ability });
  // §148: the check's DC when the roll carries it (request card, DC given to the roll: `options.target` of the D20Roll).
  const dc = Number.isFinite(rolls?.[0]?.options?.target) ? rolls[0].options.target : null;
  // §282: Heroic Inspiration first (runtime/heroic.mjs, registered before) — the reroll changes the total and the d20 read next.
  const heroic = await heroicAfter(rolls[0]);
  const rolled = heroic?.total ?? total;
  // §280: the check's ability and its DC, when the roll carries them (a rule limited to certain abilities, "when you fail").
  const used = ability ?? rolls?.[0]?.data?.abilityId ?? (skill ? actor.system?.skills?.[skill]?.ability : null) ?? null;
  const added = await offerRollBonus(actor, { kind: "check", what, total: rolled, skill, d20: heroic?.kept ?? keptD20(rolls?.[0]), needed: dc, ability: used });
  if ( added ) log(`${actor.name}: die added to their check, ${rolled} + ${added} = ${rolled + added}`);
  // §113: bardic Inspiration on a check ("when the creature fails a D20 Test") — with no known DC, up to the player to judge;
  // §148: with the DC, the question says it, and nothing on a success or when the die could not be enough.
  const inspired = await offerInspiration(actor, { what, total: rolled + added, needed: dc, test: true });
  if ( inspired ) log(`${actor.name}: Bardic Inspiration on their check, ${rolled + added} + ${inspired} = ${rolled + added + inspired}`);
}

/** On the client that writes the Initiative: is it the first this combatant receives? (read at `updateCombatant`, everywhere) */
function onPreUpdateCombatant(combatant, changes, options) {
  if ( (combatant.initiative === null) && Number.isFinite(changes?.initiative) ) options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), firstInitiative: true };
}

/**
 * §236: Superior Inspiration — "when you roll Initiative, you regain expended uses of Bardic Inspiration until you have
 * two". The `regainOnInitiative` rule: the named item's uses go back up to at least `upTo`. §278: or those of several items
 * in full, Exhaustion levels removed, at the cost of one use of the item that carries the rule (core/self-care.mjs).
 */
async function regainOnInitiative(actor) {
  const byId = new Map();
  for ( const i of actor.items ) { const id = identifierOf(i).id; if ( id && !byId.has(id) ) byId.set(id, i); }
  // A proposed rule (`activity`: Uncanny Metabolism) first: Perfect Focus only applies "if you do not
  // use it".
  const owners = actor.items.filter(i => contentOf(i).entry?.regainOnInitiative)
    .sort((a, b) => !!contentOf(b).entry.regainOnInitiative.activity - !!contentOf(a).entry.regainOnInitiative.activity);
  for ( const owner of owners ) {
    const rule = contentOf(owner).entry.regainOnInitiative;
    const items = {};
    for ( const id of [rule.item, ...(rule.items ?? [])].filter(Boolean) ) {
      const uses = byId.get(id)?.system?.uses;
      if ( Number(uses?.max) ) items[id] = { max: Number(uses.max), spent: Number(uses.spent) || 0 };
    }
    const own = owner.system?.uses;
    const usesLeft = Number(own?.max) ? (Number(own.max) - (Number(own.spent) || 0)) : null;
    const plan = initiativeRegain(rule, { items, exhaustion: Number(actor.system.attributes?.exhaustion) || 0, usesLeft });
    if ( !plan ) continue;
    if ( plan.use ) {
      const activity = owner.system.activities?.get(plan.use);
      if ( !activity ) continue;
      const answer = await askChoice(actor, {
        actor: actor.uuid, item: owner.name,
        prompt: game.i18n.format("DND5ECOMBAT.RegainInitiative.Question", { item: owner.name, back: plan.back }),
        // "No" first: with no answer within the timeout, askChoice keeps the first option — nothing goes out without agreement.
        options: [{ id: "no", label: game.i18n.localize("DND5ECOMBAT.RegainInitiative.Non") },
          { id: "yes", label: game.i18n.localize("DND5ECOMBAT.RegainInitiative.Oui") }]
      });
      if ( answer?.id !== "yes" ) { log(`${actor.name}: ${owner.name} on Initiative — declined`); continue; }
      await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }, {}).catch(() => null);
      log(`${actor.name}: ${owner.name} used on Initiative`);
      continue;
    }
    for ( const [id, spent] of Object.entries(plan.spent) ) await byId.get(id).update({ "system.uses.spent": spent });
    if ( plan.exhaustion !== null ) await actor.update({ "system.attributes.exhaustion": plan.exhaustion });
    if ( plan.pay ) await owner.update({ "system.uses.spent": (Number(own.spent) || 0) + 1 });
    log(`${actor.name}: ${owner.name} on Initiative — uses back: ${Object.keys(plan.spent).join(", ") || "none"}`
      + `${plan.exhaustion !== null ? `, Exhaustion ${plan.exhaustion}` : ""}`);
  }
}

/**
 * §236: Thief's Reflexes — "you can take two turns during the first round: the first at your Initiative, the second at your
 * Initiative minus 10". A second combatant for the same token (`extraTurn` flag), removed at round 2; not if the creature is
 * Surprised ("you can't use this feature if you are Surprised" is not in the 2024 text, but dnd5e removes Surprised at the
 * Initiative roll: the condition is read at the time of the roll). Each combatant has its turn budget (adapter/turn.mjs,
 * `combatantFor`).
 */
async function extraFirstTurn(combatant) {
  const rule = combatant.actor.items.map(i => contentOf(i).entry?.extraFirstTurn).find(Boolean);
  const combat = combatant.combat;
  if ( !rule || !combat || ((combat.round ?? 0) > 1) || combatant.getFlag(MODULE_ID, "extraTurn") ) return;
  if ( combat.combatants.some(c => (c.tokenId === combatant.tokenId) && c.getFlag(MODULE_ID, "extraTurn")) ) return;
  if ( combatant.actor.statuses?.has("surprised") ) return;
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: combatant.tokenId, sceneId: combatant.sceneId, actorId: combatant.actorId,
    initiative: combatant.initiative - rule.minus, hidden: combatant.hidden, flags: { [MODULE_ID]: { extraTurn: true } } }]);
  log(`${combatant.name}: second turn in round 1, Initiative ${combatant.initiative - rule.minus}`);
}

/** At round 2, the second turns of the first round go away. */
async function onUpdateCombat(combat, changes) {
  if ( !((changes?.round ?? 0) >= 2) ) return;
  const extra = combat.combatants.filter(c => c.getFlag(MODULE_ID, "extraTurn")).map(c => c.id);
  if ( extra.length ) await combat.deleteEmbeddedDocuments("Combatant", extra);
}

async function onUpdateCombatant(combatant, changes, options) {
  if ( !options?.[MODULE_ID]?.firstInitiative || !Number.isFinite(combatant.initiative) || !combatant.actor ) return;
  if ( !combatant.getFlag(MODULE_ID, "extraTurn") ) {
    await regainOnInitiative(combatant.actor);
    await extraFirstTurn(combatant);
  }
  const total = combatant.initiative;
  const added = await offerRollBonus(combatant.actor, { kind: "initiative", what: game.i18n.localize("DND5E.Initiative"), total });
  if ( !added ) return;
  // The value in force, not the one from before the question: a Hypervigilance may have changed it in the meantime.
  await combatant.update({ initiative: (combatant.initiative ?? total) + added });
  log(`${combatant.name}: die added to their Initiative, ${total} + ${added}`);
}

/**
 * The combatant whose Initiative card carries the roll: by the speaking token (otherwise by the actor), and whose Initiative
 * equals the total of the roll — the same token can be in several combats (seen on 2026-10-10: another combat in the world
 * corrected instead).
 */
function combatantOfMessage(message) {
  const { token, actor } = message.speaker ?? {};
  const total = message.rolls?.[0]?.total;
  const matches = game.combats.contents.flatMap(combat => combat.combatants.filter(c => (token ? c.tokenId === token : c.actorId === actor)));
  return matches.find(c => Number.isFinite(total) && (Math.abs(c.initiative - total) < 1e-6)) ?? null;
}

async function hypervigilance(message, combatant) {
  const actor = combatant?.actor;
  const item = actor?.items.find(i => contentOf(i).entry?.rerollInitiative);
  if ( !item ) return;
  const die = message.rolls?.[0]?.dice?.find(d => d.faces === 20);
  const kept = die?.results?.find(r => r.active && !r.discarded)?.result;
  // §435: the keep read also from `adv` / `dis` (dnd5e 6) — otherwise "2d20" with no keep, the sum of both dice.
  const keep = die ? d20Keep(die.modifiers, die.options?.advantageMode) : null;
  const formula = initiativeReroll(contentOf(item).entry.rerollInitiative, { number: die?.number, kept, keep });
  if ( !formula ) return;
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: item.name,
    prompt: game.i18n.format("DND5ECOMBAT.Hypervigilance.Question", { item: item.name, d20: kept, total: Math.floor(combatant.initiative) }),
    // "Keep" first: with no answer within the timeout, askChoice keeps the first option.
    options: [{ id: "keep", label: game.i18n.localize("DND5ECOMBAT.Hypervigilance.Garder") }, { id: "reroll", label: game.i18n.localize("DND5ECOMBAT.Hypervigilance.Relancer") }]
  });
  if ( answer?.id !== "reroll" ) { log(`${combatant.name}: ${item.name} — Initiative d20 ${kept} kept`); return; }
  const roll = await new Roll(formula).evaluate();
  // The value in force after the question: the Ambush die may have been added to it in the meantime.
  const total = rerolledInitiative(combatant.initiative, kept, roll.total);
  await combatant.update({ initiative: total });
  await roll.toMessage({ speaker: message.speaker,
    flavor: game.i18n.format("DND5ECOMBAT.Hypervigilance.Carte", { item: item.name, name: combatant.name, old: kept, new: roll.total, total: Math.floor(total) }),
    flags: { [MODULE_ID]: { rerollInitiative: { item: item.uuid, old: kept, new: roll.total } } } }, { messageMode: message.whisper?.length ? "gm" : undefined });
  log(`${combatant.name}: ${item.name} — Initiative d20 ${kept} rerolled → ${roll.total} (Initiative ${total})`);
}

/** Incapacitated, or no more HP: cannot swap (Alert). */
const unable = actor => !!(actor?.statuses?.has("incapacitated") || actor?.statuses?.has("unconscious") || actor?.statuses?.has("dead")
  || ((actor?.system?.attributes?.hp?.value ?? 1) <= 0));

/**
 * §129: Alert — "right after you roll Initiative, you can swap your Initiative with that of a willing ally in the same
 * combat; neither of you can be Incapacitated". To the creature's player (otherwise the GM): keep, or one of the allies who
 * already have their Initiative. The ally is not consulted: its agreement is deemed given at the table.
 */
async function alertSwap(combatant) {
  const actor = combatant?.actor;
  const item = actor?.items.find(i => contentOf(i).entry?.initiativeSwap === true);
  const combat = combatant?.parent;
  if ( !item || !combat ) return;
  const view = c => ({ ...(c.token ? sideOf(c.token) : {}), id: c.id, disposition: c.token?.disposition ?? null, initiative: c.initiative, incapacitated: unable(c.actor), down: false });
  const ids = swapPartners(view(combatant), combat.combatants.contents.filter(c => c.actor).map(view));
  if ( !ids.length ) return;
  const partners = ids.map(id => combat.combatants.get(id));
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: item.name,
    prompt: game.i18n.format("DND5ECOMBAT.Vigilant.Question", { item: item.name, total: Math.floor(combatant.initiative) }),
    // "Keep" first: with no answer within the timeout, askChoice keeps the first option.
    options: [{ id: "keep", label: game.i18n.localize("DND5ECOMBAT.Vigilant.Garder") },
      ...partners.map(c => ({ id: c.id, label: game.i18n.format("DND5ECOMBAT.Vigilant.Avec", { name: c.name, total: Math.floor(c.initiative) }) }))]
  });
  const other = (answer?.id && (answer.id !== "keep")) ? combat.combatants.get(answer.id) : null;
  if ( !other || !Number.isFinite(other.initiative) || !Number.isFinite(combatant.initiative) ) { log(`${combatant.name}: ${item.name} — Initiative kept`); return; }
  const mine = combatant.initiative;
  const theirs = other.initiative;
  await combat.updateEmbeddedDocuments("Combatant", [{ _id: combatant.id, initiative: theirs }, { _id: other.id, initiative: mine }]);
  await say({ actor }, locEsc("Vigilant.Carte", { item: item.name, name: combatant.name, other: other.name, mine: Math.floor(theirs), theirs: Math.floor(mine) }),
    { initiativeSwap: { item: item.uuid, with: other.id } });
  log(`${combatant.name}: ${item.name} — Initiative swapped with ${other.name} (${mine} <-> ${theirs})`);
}

/** Without waiting: the card's other readers follow their course while the player chooses. */
function onInitiativeMessage(message) {
  if ( !message.getFlag?.("core", "initiativeRoll") ) return;
  // The combatant is recognized by the Initiative equal to the roll's total: to be read before a reroll changes it.
  const combatant = combatantOfMessage(message);
  if ( !combatant ) return;
  enqueue(`hypervigilance:${message.id}`, async () => {
    // §282: Heroic Inspiration first (runtime/heroic.mjs); a d20 it rerolled is no longer the card's.
    const heroic = await heroicAfter(message.id);
    if ( !heroic ) await hypervigilance(message, combatant);
    await alertSwap(combatant);
  });
}

export function registerRollBonus() {
  // dnd5e 6.0: documents/actor/actor.mjs — `dnd5e.roll${name}` after a skill, tool or ability check, on the
  // client that rolled it (`subject` = the actor).
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, onCheckRolled, { label: "check die not offered" });
  }
  route("preUpdateCombatant", onPreUpdateCombatant, { label: "first Initiative not recorded" });
  route("updateCombatant", onUpdateCombatant, { executor: true, label: "Initiative die not offered" });
  route("updateCombat", onUpdateCombat, { executor: true, label: "second turn not removed" });
  route("createChatMessage", onInitiativeMessage, { executor: true, label: "Initiative d20 not rerolled" });
}
