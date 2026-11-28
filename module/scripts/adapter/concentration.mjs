/**
 * Concentration. dnd5e 6.0.3 already handles most of it (verified in the source):
 *  - concentration starts on use, replacing the previous one (activity/mixin.mjs:500)
 *  - on HP loss, a `type: "prompt"` card whispered to the owners, with a concentration
 *    save button at the right DC (data/actor/templates/attributes.mjs:699-703,
 *    documents/actor/actor.mjs:1184-1199, DC from getConcentrationDC: actor.mjs:551)
 *  - on the card of a failed save, a "Break concentration" button
 *    (data/chat-message/save-message-data.mjs:162-167)
 *  - dead or incapacitated condition: a card offering to end concentration
 *    (documents/active-effect.mjs:964-969, actor.mjs:1205-1216)
 *  - end of concentration: the effect is deleted, and with it the effects placed on the targets
 *    (`flags.dnd5e.dependentOn`, active-effect.mjs:836-860)
 * What the system does not do: click. The engine therefore adds no rule, it triggers
 * the same public calls as those buttons. The only real gap: the regions of a concentration
 * spell are not removed (a region cannot be a system "dependent").
 * The engine removes them on the DELETION of the concentration effect, seen by all clients —
 * not on `dnd5e.endConcentration`, a local hook emitted only on the client that ended it (actor.mjs,
 * `Hooks.callAll` at the end of `endConcentration`): a player who ended it themselves left the area behind.
 * The "Disable concentration tracking" setting cuts all this at the source: without the
 * native card, the engine has nothing to trigger.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { chooseRoller } from "../core/roller.mjs";
import { closeRollDialogAfter, inLine } from "./dialogs.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { concentrationRuleOf } from "../core/concentration.mjs";

/** §141: the "concentration save" request sent to the connected player; its answer. */
export const CONCENTRATION_QUERY = `${MODULE_ID}.concentration`;
export const CONCENTRATION_TIMEOUT = 40000;   // the roll window is bounded by adapter/dialogs.mjs

/**
 * Gap survey (2026-10-22): the bearer's item that exempts them from the concentration check after damage (key `keepsConcentration`,
 * Relentless Hunter), when ALL their concentration comes from the items it names; null otherwise. A concentration on another spell
 * keeps its check (it counts for all: dnd5e asks for just one).
 */
export function concentrationKeptBy(actor) {
  const effects = Array.from(actor?.concentration?.effects ?? []);
  if ( !effects.length ) return null;
  const from = effects.map(e => identifierOf(originItemOf(e) ?? {}).id);
  return actor.items.find(i => {
    const kept = contentOf(i).entry?.keepsConcentration;
    return Array.isArray(kept) && from.every(id => id && kept.includes(id));
  }) ?? null;
}

/** §494 (B14): the concentration rule carried by the actor's items (`concentration: { limit, loseAll }`), or null. */
export function concentrationRuleFor(actor) {
  return concentrationRuleOf(Array.from(actor?.items ?? []).map(i => contentOf(i).entry));
}

/**
 * §494 (B14): "if it loses concentration, it loses them all" — after the break, what remains of them (a module that would
 * have refused the end of one of them via `dnd5e.preEndConcentration`) is removed without going through that hook. Returns the
 * removed effects.
 */
export async function loseRemainingConcentration(actor) {
  const left = Array.from(actor?.concentration?.effects ?? []).filter(e => !e.isDeleted);
  if ( !left.length ) return [];
  await actor.deleteEmbeddedDocuments("ActiveEffect", left.map(e => e.id)).catch(err => {
    if ( !/does not exist/i.test(String(err?.message ?? err)) ) throw err;
  });
  return left;
}

/** The name of the spell a concentration effect held (the original item, otherwise the effect). */
export function concentrationLabel(effect) {
  const item = effect?.getFlag?.("dnd5e", "item");
  return item?.data?.name ?? effect?.parent?.items?.get?.(item?.id)?.name ?? effect?.name ?? "?";
}

/** The connected player who must roll for this actor, or null if it is up to the engine. */
export function rollerFor(actor) {
  return chooseRoller(game.users.map(u => ({
    id: u.id, active: u.active, isGM: u.isGM, owner: actor.testUserPermission(u, "OWNER")
  })));
}

/**
 * @param {ChatMessage} message  Message de type "prompt".
 * @returns {{kind: "roll"|"end", actor: Actor, dc?: number, ability?: string}|null}
 */
export function readConcentrationPrompt(message) {
  const buttons = message.system?.buttons ?? [];
  const actor = message.getAssociatedActor?.();
  if ( !actor ) return null;
  const roll = buttons.find(b => b.type === "concentration");
  if ( roll ) return { kind: "roll", actor, dc: roll.dc ?? 10, ability: roll.ability };
  if ( buttons.some(b => b.type === "endConcentration") ) return { kind: "end", actor };
  return null;
}

/** Same call as the card's button (enrichers.mjs:878-897), without a dialog. */
export async function rollConcentration({ actor, dc, ability }, promptId) {
  const config = { target: dc };
  if ( ability ) config.ability = ability;
  return actor.rollConcentration(config, { configure: false }, {
    data: { flags: { [MODULE_ID]: { concentrationPrompt: promptId } } }
  });
}

/**
 * §141: player side — the concentration roll window opens on THEIR screen, like the saves requested by the engine
 * (adapter/saves.mjs, `handleSaveQuery`); it is their dice. At the end of the timeout, the window closes and the roll goes
 * off by itself. Returns true if the roll is made (the request card is then removed by the active GM,
 * `concentrationPrompt`), false otherwise: the card stays.
 * @param {{actor: string, dc: number, ability?: string, prompt: string}} payload
 */
export async function handleConcentrationQuery({ actor: actorUuid, dc, ability=null, prompt }, { user=null }={}) {
  // §472: only the GM sends this request in play; from a player, it drops (security refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | concentration query from ${user.name} refused: only a GM sends it`); return false; }
  const actor = await fromUuid(actorUuid);
  if ( !actor ) return false;
  ui.notifications.info(game.i18n.format("DND5ECOMBAT.DemandeConcentrationJoueur", { name: actor.name, dc }));
  let timedOut = false;
  const args = () => {
    const config = { target: dc };
    if ( ability ) config.ability = ability;
    return [config, { data: { flags: { [MODULE_ID]: { concentrationPrompt: prompt } } } }];
  };
  // §401: in its turn in the queue of this client's windows.
  let rolls = await inLine(async () => {
    const cancel = closeRollDialogAfter(actor, () => { timedOut = true; }, null, { awaiting: "roll" });
    const [config, message] = args();
    try { return await actor.rollConcentration(config, { configure: true }, message); }
    finally { cancel(); }
  });
  if ( !rolls?.length && timedOut ) {
    const [again, againMessage] = args();
    rolls = await actor.rollConcentration(again, { configure: false }, againMessage);
  }
  return !!(Array.isArray(rolls) ? rolls.length : rolls);
}

/**
 * @param {ChatMessage} message  Message of type "save".
 * @returns {{actor: Actor, failed: boolean, prompt: string|null}|null}  null if it is not a concentration save.
 */
export function readConcentrationSave(message) {
  if ( message.system?.type !== "concentration" ) return null;
  const actor = message.getAssociatedActor?.();
  if ( !actor ) return null;
  return {
    actor,
    failed: message.rolls.some(r => r.isFailure) && !message.system.forceSuccess,
    prompt: message.getFlag(MODULE_ID, "concentrationPrompt") ?? null
  };
}

/** Same effect as the "Break concentration" button of the save card. */
const breaking = new Map();

export async function breakConcentration(actor, saveMessage) {
  // §303: one break at a time per creature — two paths ("end" card, failed save, end on Incapacitated) arrived together.
  const key = actor?.uuid ?? "";
  const previous = breaking.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => endNow(actor, saveMessage));
  breaking.set(key, run);
  try { return await run; } finally { if ( breaking.get(key) === run ) breaking.delete(key); }
}

async function endNow(actor, saveMessage) {
  // The caster dropped to 0 HP: their concentration can go by another path at the same moment (seen on 2026-10-12:
  // "ActiveEffect … does not exist!") — it is ended, which is what we wanted.
  // §303: already ended by the other path (dnd5e's "end" card and the failed save from the same damage) — nothing to remove, no
  // "does not exist" error in the console.
  if ( !actor?.concentration?.effects?.size ) return [];
  const ended = await actor.endConcentration().catch(err => {
    if ( /does not exist/i.test(String(err?.message ?? err)) ) return [];
    throw err;
  });
  if ( ended?.length && saveMessage ) await saveMessage.update({ "system.outcome": "broken" });
  return ended ?? [];
}

/** The concentration effect opened by a usage message, or null. */
export function concentrationEffectOf(usageMessage) {
  const id = usageMessage?.system?.concentration;
  return id ? usageMessage.getAssociatedActor?.()?.effects.get(id) ?? null : null;
}

/** Attaches a region to the concentration effect that maintains it. */
export async function tieRegionToConcentration(region, effect) {
  await region.setFlag(MODULE_ID, "concentration", effect.uuid);
}

/** Is the effect a concentration (special core condition, which dnd5e places: actor.mjs:258, active-effect.mjs:927)? */
export function isConcentrationEffect(effect) {
  return !!effect?.statuses?.has(CONFIG.specialStatusEffects.CONCENTRATING);
}

/**
 * A disabled concentration (toggle on the sheet or HUD) is no longer a concentration for dnd5e
 * (`actor.concentration.effects` counts only active effects), but it does not fall: its areas,
 * summons and dependent effects (`flags.dnd5e.dependentOn`, removed only on deletion) remain.
 * Seen on 2026-09-25: Moonbeam "stopped" by the toggle, area left on the scene.
 * @param {ActiveEffect} effect
 * @param {object} changes  Diff of `updateActiveEffect`.
 */
export function concentrationDisabled(effect, changes) {
  return isConcentrationEffect(effect) && (changes?.disabled === true);
}

/** Removes the regions maintained by a concentration effect that has just fallen. */
export async function removeRegionsOf(effectUuid) {
  let removed = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.regions.filter(r => r.getFlag(MODULE_ID, "concentration") === effectUuid).map(r => r.id);
    if ( !ids.length ) continue;
    await scene.deleteEmbeddedDocuments("Region", ids);
    removed += ids.length;
  }
  return removed;
}
