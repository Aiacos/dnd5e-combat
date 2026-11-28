/**
 * Weapon mastery properties (SPEC §21). dnd5e 6 notes the property used on the attack message; the engine draws the consequences.
 *
 *  - On the active GM, once the attack is decided and its damage applied (`dnd5e-combat.resolution`): Graze (damage equal
 *    to the modifier, on a miss), Push (3 m, at the attacker's choice), Topple (Constitution saving throw, Prone on
 *    a failure — rolled by the GM), and the marks Sap, Vex, Slow (engine effects, adapter/mastery.mjs).
 *  - The marks give their Advantage / Disadvantage to the roll (adapter/triggers.mjs, `declaredAttackModifiers`), fall at the roll
 *    they concern (attack message), or at their time: Sap and Slow at the start of the attacker's next turn,
 *    Vex at the end of its next turn.
 *  - Cleave: aiming the second attack opens for the author (ui/pointer.mjs, at no cost: `cost: "free"`, flag
 *    `cleave`); its damage is rolled without the positive modifier; once per combat turn.
 *  - Nick: turn budget (core/turn.mjs).
 *  - Topple: a PC's saving throw opens for their player if connected (query `toppleSave`), otherwise the GM rolls it.
 * Limit: cancelling an attack does not undo what the property did.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { STEPS } from "../core/action.mjs";
import { masteryEffect, grazeDamage, toppleDC, cleaveModifier, markExpires } from "../core/mastery.mjs";
import { masteryOf, attackModOf, marksOn, markData, markModifiers, standingMasteryOf, storeStanding, masteryLabel } from "../adapter/mastery.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { currentTurnKey, combatSceneActors, speakerTokenOf, turnKeyAt } from "../adapter/turn.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { conditionImmunitiesOf } from "../adapter/facts.mjs";
import { contentOf } from "../adapter/content.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { closeRollDialogAfter } from "../adapter/dialogs.mjs";
import { queryPlayer, waitLabel } from "../adapter/player-wait.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

/** §222: the Topple saving throw requested from the target's player. */
export const TOPPLE_QUERY = `${MODULE_ID}.toppleSave`;
const TOPPLE_TIMEOUT_MS = 40000;

/** The key of the current combat turn ("combat.round.tour"), or null out of combat. */
const turnKey = () => currentTurnKey();

/** Physical properties of the weapon that a damage part keeps (magical, silvered, adamantine). */
const physical = weapon => Array.from(weapon?.system?.properties ?? []).filter(p => CONFIG.DND5E.itemProperties[p]?.isPhysical);

/* -------------------------------------------- */
/*  After the attack                            */
/* -------------------------------------------- */

const seen = new Set();

/** A single queue for everything that places or removes a mark: two removals of the same effect would cause a core error. */
const MARKS = "mastery:marks";

async function mark(kind, source, target, weapon) {
  const onSource = ["vex", "studied"].includes(kind);
  const bearer = onSource ? source : target;
  // Slow: "the reduction does not exceed 3 m" — a single mark; Vex, Studied Attacks: one per target.
  const old = marksOn(bearer.actor, kind).filter(e => !onSource || (e.getFlag(MODULE_ID, "mastery").target === target.uuid));
  // An old mark may fall at the same time (consumed by this attack roll: runtime below) — we do not rely on it.
  const ids = old.map(e => e.id).filter(id => bearer.actor.effects.has(id));
  if ( ids.length ) await bearer.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  await bearer.actor.createEmbeddedDocuments("ActiveEffect", [markData(kind, { source, target, weapon, turnKey: turnKey() })]);
  notice(bearer, loc(`Botte.Retour.${kind}`), onSource ? "gain" : "ended");
  log(`mastery ${kind}: ${bearer.name} marked (${weapon?.name})`);
}

async function graze(attackMessage, source, target, weapon) {
  const n = grazeDamage(attackModOf(attackMessage));
  if ( !n ) return log(`Graze: zero modifier, nothing against ${target.name}`);
  const type = Array.from(weapon?.system?.damage?.base?.types ?? [])[0] ?? "bludgeoning";
  const logged = await inflict({
    step: { formula: String(n), damageType: type }, item: weapon, targetUuid: target.uuid, properties: physical(weapon),
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: loc("Botte.Carte.graze", { weapon: weapon?.name ?? "", name: target.name }),
    flags: { mastery: { kind: "graze", target: target.uuid, amount: n } }
  });
  log(`Graze: ${target.name} takes ${n} ${type}${logged ? ` (HP ${logged.before?.value} -> ${logged.after?.value})` : ""}`);
}

async function push(source, target, weapon) {
  const answer = await askChoice(source.actor, {
    actor: source.actor.uuid, item: weapon?.name ?? "",
    prompt: loc("Botte.Poussee.Question", { name: target.name }),
    options: [{ id: "push", label: loc("Botte.Poussee.Oui") }, { id: "none", label: loc("Botte.Poussee.Non") }]
  });
  if ( answer?.id !== "push" ) return log(`Push: ${source.name} does not push ${target.name}`);
  const { cells, wanted } = await pushAway(source, target, { distance: 10, units: "ft" }, readUnitFactors());
  log(`Push: ${target.name} pushed ${cells} square(s) out of ${wanted}`);
}

/**
 * The Topple Constitution saving throw, on this client: roll window (`configure`, closed at the combat windows' delay,
 * then rolled alone) or without a window. Returns the total, or null with no roll.
 */
async function rollToppleSave({ token: uuid, dc, weapon, configure=false }, { user=null }={}) {
  // §472: only the GM sends this query in play; from a player, it drops (safety refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | topple query from ${user.name} refused: only a GM sends it`); return null; }
  const target = await fromUuid(uuid);
  const actor = target?.actor;
  if ( !actor ) return null;
  const roll = configure => actor.rollSavingThrow({ ability: "con", target: dc }, { configure },
    { data: { flavor: loc("Botte.Carte.topple", { weapon: weapon ?? "", name: target.name, dc }),
      flags: { [MODULE_ID]: { mastery: { kind: "topple", target: target.uuid, dc } } } } });
  const cancel = configure ? closeRollDialogAfter(actor, () => {}, null, { awaiting: "roll" }) : () => {};
  let rolls = await roll(configure);
  cancel();
  if ( !rolls?.length && configure ) rolls = await roll(false);
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? total : null;
}

async function topple(attackMessage, source, target, weapon) {
  const dc = toppleDC(attackModOf(attackMessage), source.actor?.system?.attributes?.prof);
  // §222: a PC whose player is connected rolls their saving throw on their side; otherwise (NPC, absent player, no answer), here.
  const payload = { token: target.uuid, dc, weapon: weapon?.name ?? "" };
  const userId = rollerFor(target.actor);
  const user = userId ? game.users.get(userId) : null;
  let total = null;
  if ( user && !user.isSelf ) total = await queryPlayer(user, TOPPLE_QUERY, { ...payload, configure: true },
    { timeout: TOPPLE_TIMEOUT_MS, actor: target.actor, label: waitLabel("Renversement", { dc }) }).catch(() => null);
  if ( !Number.isFinite(total) ) total = await rollToppleSave(payload);
  if ( !Number.isFinite(total) ) return;
  const saved = total >= dc;
  log(`Topple: ${target.name} ${saved ? "succeeds on" : "fails"} its Constitution saving throw (${total} vs DC ${dc})`);
  if ( saved || target.actor.statuses.has("prone") || conditionImmunitiesOf(target.actor).includes("prone") ) return;
  await target.actor.toggleStatusEffect("prone", { active: true });
}

/** §21: Studied Attacks — each creature missed by this roll is marked: Advantage on the next roll against it. */
async function studied(resolution, source, item) {
  if ( !source?.actor?.items.some(i => contentOf(i).entry?.studiedAttacks === true) ) return;
  for ( const t of resolution.targets ?? [] ) {
    if ( t.hit !== false ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( target?.actor ) await mark("studied", source, target, item);
  }
}

async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  if ( !attackMessage ) return;
  seen.add(resolution.id);
  const source = speakerTokenOf(attackMessage);
  const activity = fromUuidSync(resolution.activity, { strict: false });
  const weapon = activity?.item ?? null;
  if ( !source?.actor || !weapon ) return;
  await studied(resolution, source, weapon);
  const mastery = masteryOf(attackMessage);
  if ( !mastery ) return;
  const mode = attackMessage.rolls?.[0]?.options?.attackMode ?? attackMessage.system?.mode ?? "";
  const melee = (activity.attack?.type?.value === "melee") && !mode.includes("thrown") && (mode !== "ranged");
  for ( const t of resolution.targets ?? [] ) {
    if ( (t.hit !== true) && (t.hit !== false) ) continue;
    const target = fromUuidSync(t.token, { strict: false });
    if ( !target?.actor ) continue;
    const effect = masteryEffect(mastery, {
      hit: t.hit, damaged: (t.damage?.applied ?? 0) > 0, melee, size: target.actor.system.traits?.size ?? null,
      down: (target.actor.system.attributes?.hp?.value ?? 1) <= 0, cleaveSpent: true   // Cleave: author-side (ui/pointer.mjs)
    });
    if ( !effect ) continue;
    if ( effect === "graze" ) await graze(attackMessage, source, target, weapon);
    else if ( effect === "push" ) await push(source, target, weapon);
    else if ( effect === "topple" ) await topple(attackMessage, source, target, weapon);
    else await mark(effect, source, target, weapon);
  }
}

/* -------------------------------------------- */
/*  The marks: consumed at the roll, removed at their time  */
/* -------------------------------------------- */

async function onAttackRolled(message) {
  const source = speakerTokenOf(message);
  if ( !source?.actor ) return;
  const removed = new Set();
  for ( const t of message.system?.targets ?? [] ) {
    const target = fromUuidSync(t.token, { strict: false });
    for ( const effect of markModifiers(source, target).consumed ) {
      if ( removed.has(effect.uuid) ) continue;
      removed.add(effect.uuid);
      const actor = effect.parent;
      if ( !actor?.effects?.has(effect.id) ) continue;   // already removed (re-placed by a previous hit's property)
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      log(`mastery: "${effect.name}" used up by ${source.name}'s roll`);
    }
  }
}

async function expire(combat, combatantId, moment, key) {
  if ( !combatantId ) return;
  for ( const actor of combatSceneActors(combat) ) {
    const gone = marksOn(actor).filter(e => {
      const m = e.getFlag(MODULE_ID, "mastery");
      return markExpires(m.kind, { moment, sourceTurn: m.combatant === combatantId, turnKey: key, placedOn: m.placedOn });
    });
    if ( !gone.length ) continue;
    const ids = gone.map(e => e.id).filter(id => actor.effects.has(id));
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`mastery: ${gone.map(e => e.name).join(", ")} removed ${moment === "turnStart" ? "at the start" : "at the end"} of the turn`);
  }
}

function onTurnChange(combat, prior, current) {
  // `prior`: the turn that is ending (its key: combat, round, turn of then); `current`: the one that is starting.
  const priorKey = turnKeyAt(combat, prior);
  return enqueue(MARKS, async () => {
    await expire(combat, prior?.combatantId, "turnEnd", priorKey);
    await expire(combat, current?.combatantId, "turnStart", null);
  });
}

/* -------------------------------------------- */
/*  Cleave                                      */
/* -------------------------------------------- */

/** On the author's client: the second Cleave attack is rolled without the positive ability modifier. */
function onPreRollDamage(config, dialog, message) {
  const origin = foundry.utils.getProperty(message ?? {}, "data.system.origin");
  if ( !origin || !game.messages.get(origin)?.getFlag(MODULE_ID, "cleave") ) return true;
  for ( const roll of config.rolls ?? [] ) {
    if ( !roll.base || !roll.data || !((roll.data.mod ?? 0) > 0) ) continue;
    roll.data = { ...roll.data, mod: cleaveModifier(roll.data.mod) };
  }
  log("Cleave: damage without the ability modifier");
  return true;
}

/** The second Cleave attack is made: "once per turn". */
async function onCleaveUsed(message) {
  const actor = message.getAssociatedActor?.();
  const key = turnKey();
  if ( actor && key ) await actor.setFlag(MODULE_ID, "cleaveTurn", key);
}

/* -------------------------------------------- */
/*  Standing mastery per weapon (§537, #160)    */
/* -------------------------------------------- */

/**
 * §537 : on every attack roll (`dnd5e.preRollAttackV2`, before the configuration window, which dnd5e skips with fast attacks), the
 * weapon's standing choice becomes `config.mastery`; dnd5e reads it in `_buildAttackConfig` (documents/activity/attack.mjs) and records
 * it on the attack message (`system.mastery`), which the rest of this file plays. dnd5e has already set `config.mastery` to its default
 * (the weapon's own, or the last one used) before this hook, so the standing choice always replaces it. With fast attacks off, dnd5e's
 * window still shows its mastery list (decided before the hook): a one-attack change stays possible there (not played in game).
 */
function onPreRollAttack(config) {
  const item = config?.subject?.item;
  const mastery = standingMasteryOf(item);
  if ( !mastery ) return true;
  config.mastery = mastery;
  log(`standing mastery: ${item.name} attacks with ${mastery}`);
  return true;
}

/**
 * §537 : store the standing mastery of a weapon (menu of the token or of the sheet), with feedback for the whole table. Returns the
 * mastery now used, or null when the weapon does not offer `choice`.
 * @param {Item5e} item
 * @param {string} choice   A mastery key among the weapon's options.
 */
export async function setStandingMastery(item, choice) {
  if ( !item?.isOwner ) return null;
  const used = await storeStanding(item, choice);
  const token = tokenOf(item.actor);
  if ( used === undefined ) {
    if ( token ) notice(token, loc("Botte.Permanente.Refus", { weapon: item.name }));
    return null;
  }
  if ( token ) notice(token, { key: "Botte.Permanente.Retour", data: { weapon: item.name, mastery: masteryLabel(used) } }, "gain",
    { all: true, action: "standingMastery", outcome: "success" });
  log(`standing mastery: ${item.actor?.name} - ${item.name} now uses ${used}`);
  return used;
}

export function registerMastery() {
  // On all clients: it is the target's player's client that rolls their saving throw.
  CONFIG.queries[TOPPLE_QUERY] = rollToppleSave;
  route(`${MODULE_ID}.resolution`, resolution => enqueue(MARKS, () => onResolution(resolution)),
    { executor: true, label: "weapon mastery not played" });
  route("createChatMessage", message => {
    if ( message.type === "attack" ) return enqueue(MARKS, () => onAttackRolled(message));
    if ( (message.type === "usage") && message.getFlag(MODULE_ID, "cleave") ) return onCleaveUsed(message);
  }, { executor: true, label: "weapon mastery: mark not used up" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "weapon mastery: mark not removed" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "Cleave: modifier" });
  route("dnd5e.preRollAttackV2", onPreRollAttack, { cancellable: true, label: "standing mastery not applied" });
}
