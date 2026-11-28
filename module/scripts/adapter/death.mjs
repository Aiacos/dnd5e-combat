/**
 * At 0 Hit Points, read and written in Foundry for the core (core/death.mjs). Verified in dnd5e 6.0.3:
 *  - `Actor5e#applyDamage` calls `dnd5e.preApplyDamage(actor, amount, updates, options)` with `Hooks.call`
 *    BEFORE the write, on the client that applies: adding a key to `updates` writes it in the same update
 *    (documents/actor/actor.mjs, `applyDamage`). `amount`: damage after Resistances, before Temporary Hit Points;
 *    `options.origin` or `options.originatingMessage`: the damage message, which carries the critical.
 *  - at 0 HP, an update that changes only the HP changes nothing (HP clamped to 0): without this key, nothing is
 *    written, and `updateDowned` (which sets Unconscious / Dead) only runs if the HP change.
 *  - `rollDeathSave` counts successes and failures and calls `dnd5e.rollDeathSaveV2(rolls, { outcome, updates, subject })`
 *    (`outcome`: "stable", "death", "revive" or null), but does not set Stable; Dead, yes, when the write
 *    of the three failures goes through `onUpdateDeathSaves` (data/actor/templates/attributes.mjs) and the setting allows it.
 *  - the world setting `autoApplyDowned` ("none", "deadOnly", "npcs", "all") says whether the system sets these conditions;
 *    the engine follows the same rule for Dead (actor.mjs, `updateDowned`). Stable is always set: it is what
 *    tells the engine to stop asking for a roll.
 * The conditions set here carry `flags["dnd5e-combat"].death`: the engine removes them when the HP rise.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { contentOf } from "./content.mjs";
import { makesDeathSaves, damageAtZero, needsDeathSave, statusAfterDeathSave, downedStatus, isDead, canStabilize } from "../core/death.mjs";
import { rollerFor } from "./concentration.mjs";
import { closeRollDialogAfter, inLine } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { transformsAtZero, standsAtZero } from "./coven.mjs";
import { regenerationOf } from "./regeneration.mjs";
import { relentlessAtZero } from "./rage.mjs";
import { knockOutAtZero, KNOCKED_OUT_FLAG } from "./knockout.mjs";
import { endureAtZero } from "./species.mjs";
import { wardAtZero } from "./ward.mjs";
import { planFortitude, pendingFortitude } from "./fortitude.mjs";
import { risingAtZero } from "./rise.mjs";
import { isWildShaped } from "./wildshape.mjs";

/**
 * The time left to dnd5e to set its 0 HP condition (Dead, Unconscious) on the client that wrote the HP (`updateDowned`,
 * data/actor/templates/attributes.mjs:732) before an engine rule reads or replaces it.
 */
export const AFTER_ZERO_HP_MS = 400;

export const DEATH_QUERY = `${MODULE_ID}.deathSave`;
const DEATH_TIMEOUT = 40000;

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Mort.${key}`, data ?? {});

function savesOf(actor) {
  return makesDeathSaves({ type: actor?.type, important: !!actor?.system?.traits?.important });
}

/** §18.13: a Regeneration that keeps one alive at 0 HP until the start of the turn (Troll, Revenant). */
const regeneratesAtZero = actor => !!regenerationOf(actor)?.survivesZero;

/**
 * §71: dropped to 0 HP under a `stableAtZero` weapon ("Shadow Dagger of the Vampire Familiar": "it ends up Stable") —
 * flag written in the SAME update as the HP (`planDamageAtZero`), read by all clients before setting Dead or Unconscious.
 */
const keptStable = actor => !!actor?.getFlag?.(MODULE_ID, "stableAtZero");

/** Survives at 0 HP without death saving throws: Regeneration, or stabilized by the weapon that dropped it there. */
const survivesZero = actor => regeneratesAtZero(actor) || keptStable(actor);

/** The damage's item (dnd5e damage message, `options.originatingMessage`), or null. */
function damageItemOf(options) {
  const message = options?.originatingMessage ?? options?.origin;
  return message?.getAssociatedActivity?.()?.item ?? message?.getAssociatedItem?.() ?? null;
}

/** Is the actor dead? (core/death.mjs, `isDead`) — for cover and shooting in close combat. */
export function isDeadActor(actor) {
  const hp = actor?.system?.attributes?.hp;
  if ( !actor || !hp ) return !!actor?.statuses?.has("dead");
  return isDead({ hp: hp.value, saves: savesOf(actor) || survivesZero(actor) || transformsAtZero(actor) || standsAtZero(actor) || !!pendingFortitude(actor) || risingAtZero(actor), statuses: Array.from(actor.statuses) });
}

/** Is the damage message a Critical Hit? */
function isCriticalDamage(options) {
  // #269 (§545): the engine's verdict for this target, when the engine applies (adapter/messages.mjs, `applyDamageToToken`).
  const own = options?.[MODULE_ID]?.criticalHit;
  if ( typeof own === "boolean" ) return own;
  const message = options?.originatingMessage ?? options?.origin;
  // §207: a critical handled by the table (normal damage) remains a Critical Hit.
  return !!message?.rolls?.some?.(r => r.isCritical || r.options?.isCritical) || !!message?.getFlag?.(MODULE_ID, "criticalHit");
}

async function announce(actor, key, data, kind) {
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${t(key, { name: actor.name, ...data })}</p>`,
    flags: { [MODULE_ID]: { death: { kind, actor: actor.uuid, ...data } } }
  });
}

/**
 * Sets a system condition ("dead", "stable") marked by the engine, if it is not already there. The system may
 * set Dead at the same moment (`updateDowned`, as soon as an HP update sees three failures): the condition's identifier
 * is fixed (`keepId`), the second creation fails, and it is harmless.
 */
export async function setDeathStatus(actor, id) {
  if ( actor.statuses.has(id) ) return null;
  const effect = await ActiveEffect.implementation.fromStatusEffect(id);
  const flags = { [MODULE_ID]: { death: true } };
  if ( id === "dead" ) flags.core = { overlay: true };
  effect.updateSource({ flags });
  try { return await ActiveEffect.implementation.create(effect, { parent: actor, keepId: true }); }
  catch(err) { if ( actor.statuses.has(id) || actor.effects.has(effect.id) ) return null; throw err; }
}

/**
 * Removes effects one by one, without failing on an effect already removed elsewhere in the meantime (§18.18):
 * `deleteEmbeddedDocuments` refuses the whole operation if one of them no longer exists ("ActiveEffect … does not exist"),
 * and the error went to the console — seen when the scenarios' safety net removed Dead from a boss at the same time as the
 * engine (§18.7).
 */
async function deleteEffects(actor, ids) {
  for ( const id of ids ) {
    if ( !actor.effects.has(id) ) continue;
    try { await actor.deleteEmbeddedDocuments("ActiveEffect", [id]); }
    catch(err) { if ( actor.effects.has(id) ) throw err; }
  }
}

async function removeStable(actor) {
  // §16.47: whatever its source (the engine, or the spell Spare the Dying).
  const ids = actor.effects.filter(e => e.statuses.has("stable")).map(e => e.id);
  await deleteEffects(actor, ids);
}

async function markDead(actor, reason, data={}) {
  await announce(actor, reason === "massive" ? "SurLeCoup" : "TroisEchecs", data, reason);
  await removeStable(actor);
  await setDeathStatus(actor, "dead");
}

/**
 * §18.13: the Dead that dnd5e automatically sets on an NPC at 0 HP in combat (`updateDowned`, flag `autoDowned`,
 * documents/actor/actor.mjs:3671-3682) does not apply to a creature that can still regenerate. dnd5e sets it again on each
 * HP write, asynchronously: it is also removed at its creation (runtime/regeneration.mjs). Returns true if removed.
 */
export async function dropAutoDead(actor) {
  if ( !survivesZero(actor) ) return false;
  const auto = actor.effects.filter(e => e.getFlag("dnd5e", "autoDowned") && e.statuses.has("dead")).map(e => e.id);
  if ( !auto.length ) return false;
  await deleteEffects(actor, auto);
  return true;
}

/**
 * §17.1: at 0 HP, Dead or Unconscious (which brings Incapacitated and Prone, `CONFIG.DND5E.conditionTypes.unconscious`,
 * riders set by dnd5e at creation, documents/active-effect.mjs `_onCreateOperation`), whatever the "Auto-Apply Downed" setting
 * and even out of combat. Marked by the engine: removed when the HP rise. Active GM.
 * @returns {Promise<"dead"|"unconscious"|null>}
 */
export async function ensureDowned(actor, { afterUpdate=false }={}) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp ) return null;
  // §19.5: a creature with a second phase does not fall, it changes form (runtime/coven.mjs).
  // §22: Relentless Rage — the Constitution save decides first (runtime/barbarian.mjs); §61: Undead Fortitude.
  // §155: in Wild Shape, 0 HP ends the form (runtime/wildshape.mjs), which deletes the transformed actor —
  // setting Unconscious on it crossed with that deletion ("The Actor … does not exist").
  if ( (hp.value <= 0) && isWildShaped(actor) ) return null;
  if ( (hp.value <= 0) && (transformsAtZero(actor) || standsAtZero(actor) || relentlessAtZero(actor) || pendingFortitude(actor) || risingAtZero(actor)) ) return null;
  const regenerates = (hp.value <= 0) && survivesZero(actor);
  if ( regenerates ) await dropAutoDead(actor);
  const status = downedStatus({ hp: hp.value, saves: savesOf(actor), statuses: Array.from(actor.statuses),
    failures: actor.system.attributes.death?.failure ?? 0, regenerates });
  if ( !status ) return null;
  // HP that have just been written, in combat: dnd5e itself sets this condition, with the same id (`keepId`), on the client that
  // wrote (`updateDowned`, data/actor/templates/attributes.mjs:732; actor.mjs:3652-3682). The two creations
  // crossed and dnd5e's failed in the console ("_id dnd5edead0000000 already exists", seen on 2026-09-26). We
  // give it a moment, and only set the condition if it is still missing: an HP write in an unlinked token's delta
  // (tool, macro) does not go through `updateDowned`, and nothing else would set it.
  if ( afterUpdate && !regenerates && (systemDowned(actor) === status) ) {
    await new Promise(resolve => setTimeout(resolve, AFTER_ZERO_HP_MS));
    if ( actor.statuses.has(status) ) return null;
  }
  await setDeathStatus(actor, status);
  return status;
}

/** The condition that dnd5e sets itself at 0 HP (`updateDowned`, "Auto-Apply Downed" setting), or null. */
function systemDowned(actor) {
  const mode = globalThis.dnd5e?.settings?.autoApplyDowned ?? "none";
  if ( (mode === "none") || !actor.inCombat ) return null;
  const failed = (actor.system.attributes.death?.failure ?? 0) >= 3;
  if ( actor.type === "npc" ) {
    if ( !actor.system.traits?.important ) return "dead";
    return (mode !== "deadOnly") ? (failed ? "dead" : "unconscious") : null;
  }
  if ( (actor.type === "character") && (mode === "all") ) return failed ? "dead" : "unconscious";
  return null;
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * `dnd5e.preApplyDamage` (synchronous): writes the failures into the damage update and keeps in
 * `options` what will have to be set afterwards. On the client that applies the damage.
 */
export function planDamageAtZero(actor, amount, updates, options) {
  const hp = actor?.system?.attributes?.hp;
  const death = actor?.system?.attributes?.death;
  if ( !hp || !death || !(amount > 0) || actor.statuses.has("dead") ) return;
  if ( transformsAtZero(actor) || standsAtZero(actor) ) return;   // §19.5-6: no failure or death; second phase or amulet takes over
  // §16.11: what a reserve (Arcane Ward) absorbed, recorded earlier in this same hook, does not reach the creature.
  const incoming = Math.max(0, amount - (options?.[MODULE_ID]?.absorbed ?? 0));
  const through = incoming - Math.min(hp.temp ?? 0, incoming);
  // §210: a non-lethal melee hit — to 1 HP instead of 0, Unconscious (set afterwards, `settleDamageAtZero`).
  const knocker = knockOutAtZero(actor, through, updates, options);
  if ( knocker ) {
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), knockedOut: knocker };
    return;
  }
  // §73: Death Ward — to 1 HP instead of 0 (even killed outright: it does not fall to 0), the spell ends.
  const warded = wardAtZero(actor, through, updates);
  if ( warded ) {
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), endured: warded.name };
    return;
  }
  // §31: Relentless Endurance (Orc) — to 1 HP instead of 0, with no failure or death (unless killed outright).
  const endured = endureAtZero(actor, through, updates);
  if ( endured ) {
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), endured: endured.name };
    return;
  }
  // §71: a weapon that stabilizes what it drops — no failure or death; flag written with the HP, Stable set afterwards.
  if ( (hp.value > 0) && (through >= hp.value) && contentOf(damageItemOf(options)).entry?.stableAtZero ) {
    updates[`flags.${MODULE_ID}.stableAtZero`] = true;
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), death: { stable: true } };
    return;
  }
  // Already at 0 and kept alive by such a weapon: new damage follows the ordinary rule (an NPC dies).
  if ( (hp.value <= 0) && keptStable(actor) && (through > 0) ) updates[`flags.${MODULE_ID}.stableAtZero`] = new foundry.data.operators.ForcedDeletion();
  const critical = isCriticalDamage(options);
  // §61: Undead Fortitude — the save due goes out with the HP; no failure or death until it is played.
  const taken = incoming;
  if ( planFortitude(actor, { hp: hp.value, through, taken, types: options?.[MODULE_ID]?.takenTypes ?? [], critical }, updates) ) return;
  const outcome = damageAtZero({ hp: hp.value, max: hp.max, through, critical, failures: death.failure ?? 0, saves: savesOf(actor) });
  if ( !outcome.dead && (outcome.failures === null) ) return;
  if ( outcome.failures !== null ) updates["system.attributes.death.failure"] = outcome.failures;
  options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), death: { ...outcome, critical, through, max: hp.max, before: hp.value } };
}

/** `dnd5e.applyDamage`: sets Dead, removes Stable, and says so in the chat. */
export async function settleDamageAtZero(actor, amount, options) {
  // §210: knocked out — Unconscious at 1 HP, until HP are regained or first aid (runtime/knockout.mjs).
  const knocker = options?.[MODULE_ID]?.knockedOut;
  if ( knocker ) {
    await actor.setFlag(MODULE_ID, KNOCKED_OUT_FLAG, { by: knocker });
    if ( !actor.statuses.has("unconscious") ) await actor.toggleStatusEffect("unconscious", { active: true });
    await announce(actor, "Assomme", { by: knocker }, "knockedOut");
    return { knockedOut: knocker };
  }
  const outcome = options?.[MODULE_ID]?.death;
  if ( !outcome ) return null;
  if ( outcome.stable ) {
    // §71: Stable, and the Dead that dnd5e automatically sets on an NPC at 0 HP (`autoDowned`) removed — Unconscious instead.
    await setDeathStatus(actor, "stable");
    await dropAutoDead(actor);
    await ensureDowned(actor);
    await announce(actor, "Stabilise", {}, "stable");
    return outcome;
  }
  if ( outcome.dead ) {
    const data = outcome.reason === "massive"
      ? { remainder: outcome.through - outcome.before, max: outcome.max }
      : { failures: outcome.failures };
    await markDead(actor, outcome.reason, data);
    return outcome;
  }
  if ( outcome.unstable ) await removeStable(actor);
  await announce(actor, outcome.critical ? "EchecsCritique" : "Echec", { failures: outcome.failures }, "failure");
  return outcome;
}

/* -------------------------------------------- */
/*  Jet contre la mort                          */
/* -------------------------------------------- */

/**
 * §50: stabilize a creature at 0 HP (healer's kit) — like three successes on death saving throws: Stable set by the
 * engine (removed when the HP rise or it takes damage), announced in the chat. Returns false if there is nothing to do.
 */
export async function stabilize(actor, { by="", with: tool="" }={}) {
  const hp = actor?.system?.attributes?.hp?.value ?? 1;
  if ( !canStabilize({ hp, statuses: Array.from(actor?.statuses ?? []) }) ) return false;
  await setDeathStatus(actor, "stable");
  await announce(actor, "StabiliseSoins", { by, tool }, "stable");
  return true;
}

/** `dnd5e.rollDeathSaveV2`: Stable after three successes, Dead after three failures. On the client that rolled. */
export async function settleDeathSave(actor, outcome) {
  const status = statusAfterDeathSave(outcome);
  if ( status === "stable" ) {
    await setDeathStatus(actor, "stable");
    return announce(actor, "Stabilise", {}, "stable");
  }
  if ( status === "dead" ) return markDead(actor, "failures", { failures: 3 });
  return null;
}

/** Must the creature roll a death saving throw? */
export function deathSaveDue(actor) {
  const hp = actor?.system?.attributes?.hp;
  const death = actor?.system?.attributes?.death;
  if ( !hp || !death ) return false;
  return needsDeathSave({ hp: hp.value, saves: savesOf(actor), statuses: Array.from(actor.statuses),
    failures: death.failure ?? 0, successes: death.success ?? 0 });
}

/**
 * Player side: the death saving throw window opens on THEIR screen; it is their dice. The roll is not
 * optional: window closed or timeout elapsed, it goes without a window, always on their client.
 */
export async function handleDeathSaveQuery({ actor: actorUuid }, { user=null }={}) {
  // §472: only the GM sends this request in play; from a player, it is dropped (security refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | deathSave query from ${user.name} refused: only a GM sends it`); return false; }
  const actor = await fromUuid(actorUuid);
  if ( !actor?.isOwner || !deathSaveDue(actor) ) return false;
  ui.notifications.info(t("DemandeJoueur", { name: actor.name }));
  // §401: in turn in the queue of this station's windows.
  let rolls = await inLine(async () => {
    const cancel = closeRollDialogAfter(actor, () => {}, null, { awaiting: "roll" });
    try { return await actor.rollDeathSave({}, { configure: true }); }
    finally { cancel(); }
  });
  if ( !rolls?.length && deathSaveDue(actor) ) rolls = await actor.rollDeathSave({}, { configure: false });
  return !!rolls?.length;
}

/**
 * At the start of the turn: the connected player who owns the creature rolls on their side; otherwise (important NPC, PC without a
 * player, a player who does not respond) the engine rolls. Active GM only.
 */
export async function requestDeathSave(actor) {
  const userId = rollerFor(actor);
  if ( userId ) {
    const rolled = await queryPlayer(game.users.get(userId), DEATH_QUERY, { actor: actor.uuid }, { timeout: DEATH_TIMEOUT, actor, label: waitLabel("Mort") })
      .catch(() => false);
    if ( rolled || !deathSaveDue(actor) ) return "player";
  }
  await actor.rollDeathSave({}, { configure: false });
  return "engine";
}

/* -------------------------------------------- */
/*  Return to life                              */
/* -------------------------------------------- */

/** The HP rise: the Dead and Stable conditions that the engine had set drop off. Active GM only. */
export async function clearDeathMarks(actor) {
  if ( !(actor?.system?.attributes?.hp?.value > 0) ) return 0;
  // Dead and Stable set by the engine; Stable, whatever its source (Spare the Dying, §16.47).
  const ids = actor.effects.filter(e => e.getFlag(MODULE_ID, "death") || e.statuses.has("stable")).map(e => e.id);
  await deleteEffects(actor, ids);
  if ( keptStable(actor) ) await actor.unsetFlag(MODULE_ID, "stableAtZero");   // §71
  return ids.length;
}
