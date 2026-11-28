/**
 * §36: Diviner's Portent (core/portent.mjs) on the Foundry side — the rolls noted on the diviner, who can use them, and the
 * question.
 *
 * Verified:
 *  - `dnd5e.restCompleted(actor, result, config)`, `config.type` = "long" for a Long Rest (documents/actor/actor.mjs:2299, 2421).
 *  - A roll's d20 is bounded by `options.minimum` / `options.maximum` of the first roll of the configuration: D20Roll applies
 *    them to the die (dice/d20-roll.mjs:259-266, `applyRange` of d20-die.mjs:104-112) and merges them with those of the system
 *    (`mergeOptions`, d20-roll.mjs:297-303); "1d20min7max7" is worth 7, even with Advantage; a noted 20 is a Critical Hit
 *    (d20-die.mjs:33-37, the die's total after bounds).
 *
 * The rolls live on the diviner's actor: `flags["dnd5e-combat"].portent` = { rolls, turn }. Who writes them: whoever answers the
 * question (the diviner's player, or the GM), owner of the actor.
 */

import { MODULE_ID } from "../constants.mjs";
import { readPortent, canForetell, portentChoices, spendPortent } from "../core/portent.mjs";
import { contentOf } from "./content.mjs";
import { timedWait } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { rollerFor } from "./concentration.mjs";
import { canSee } from "./vision.mjs";
import { currentTurnKey } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";
import { areAllies } from "./factions.mjs";
import { settingOr } from "./settings.mjs";

export const PORTENT_QUERY = `${MODULE_ID}.portent`;
/** §38.4: world setting "Diviner's Portent" — does the engine offer it? (on by default) */
export const PORTENT_SETTING = "portent";
const portentOffered = () => settingOr(PORTENT_SETTING, true) !== false;
const PORTENT_TIMEOUT = 20000;   // beyond the window's timeout (adapter/dialogs.mjs)

/** How many d20 the diviner notes at each Long Rest (0: no Portent). Greater Portent overrides Portent. */
export function portentDice(actor) {
  let dice = 0;
  for ( const item of actor?.items ?? [] ) dice = Math.max(dice, contentOf(item).entry?.portent?.dice ?? 0);
  return dice;
}

/** The diviner's noted rolls, as they have them. */
export const portentOf = actor => readPortent(actor?.getFlag(MODULE_ID, "portent"));

/** Long Rest: the remaining rolls are cleared, new d20 are rolled and noted — the card is seen only by the diviner and the GM. */
export async function rollPortent(actor) {
  const dice = portentDice(actor);
  if ( !dice ) return null;
  const roll = await new Roll(`${dice}d20`).evaluate();
  const rolls = roll.dice[0].results.map(r => r.result);
  await actor.setFlag(MODULE_ID, "portent", { rolls, turn: null });
  const data = await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.format("DND5ECOMBAT.Presage.Notes", { rolls: rolls.join(", ") }),
    flags: { [MODULE_ID]: { portent: { rolled: rolls } } }
  }, { create: false });
  data.whisper = game.users.filter(u => u.isGM || actor.testUserPermission(u, "OWNER")).map(u => u.id);
  data.blind = false;
  await ChatMessage.implementation.create(data);
  return rolls;
}

/** The noted roll is used: removed, the turn recorded, and the card says so. Returns false if no longer noted. Actor owner. */
async function useForetold(actor, value, { subject, kind }) {
  const spent = spendPortent(actor.getFlag(MODULE_ID, "portent"), value, currentTurnKey());
  if ( !spent ) return false;
  await actor.setFlag(MODULE_ID, "portent", spent);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${game.i18n.format("DND5ECOMBAT.Presage.Utilise", { name: actor.name, subject, value })}</p>`,
    flags: { [MODULE_ID]: { portent: { used: value, subject, kind, left: spent.rolls } } }
  });
  return true;
}

/**
 * The diviners who can replace this creature's d20 Test: on its scene, alive and conscious, with noted rolls not yet used
 * this turn, and who see it (the creature itself counts: "made by you"). Incapacitated, they can: Portent is not a Reaction.
 * `skip`: token ids not to consult (those that just declined).
 * @param {TokenDocument} subject
 * @returns {Array<{token: TokenDocument, choices: number[]}>}
 */
export function seersOf(subject, { skip=null }={}) {
  if ( !subject?.parent || !portentOffered() ) return [];
  const turnKey = currentTurnKey();
  const out = [];
  for ( const token of subject.parent.tokens ) {
    const actor = token.actor;
    // The flag first: with no noted roll, nothing more to read (called on every attack and every save).
    const state = actor?.getFlag(MODULE_ID, "portent");
    if ( !state?.rolls?.length || !canForetell(state, turnKey) || skip?.has(token.id) ) continue;
    if ( token.hidden || isObjectToken(token) || !portentDice(actor) ) continue;
    if ( ((actor.system.attributes?.hp?.value ?? 1) <= 0) || ["dead", "unconscious"].some(s => actor.statuses?.has(s)) ) continue;
    if ( (token !== subject) && ((canSee(token, subject) ?? true) === false) ) continue;
    out.push({ token, choices: portentChoices(state) });
  }
  return out;
}

/**
 * On the diviner's side (their player, or the GM): a window, one button per noted roll, and "do not use it" — the default answer, a
 * roll is never spent without consent. The chosen roll is spent here (actor owner), and the card says so.
 * @param {{actor: string, subject: string, kind: "attack"|"save", item: string}} payload
 * @returns {Promise<{value: number}|null>}
 */
export async function handlePortentQuery({ actor: actorUuid, subject, kind, item }) {
  const actor = await fromUuid(actorUuid);
  if ( !actor ) return null;
  const choices = portentChoices(actor.getFlag(MODULE_ID, "portent"));
  if ( !choices.length ) return null;
  const buttons = choices.map((n, i) => ({ action: `v${n}`, label: game.i18n.format("DND5ECOMBAT.Presage.Remplacer", { value: n }),
    icon: "fa-solid fa-eye", default: i === 0 }));
  buttons.push({ action: "none", label: game.i18n.localize("DND5ECOMBAT.Presage.Non") });
  const picked = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.Presage.Titre", { name: actor.name }) },
    content: `<p>${game.i18n.format(`DND5ECOMBAT.Presage.${kind === "save" ? "Sauvegarde" : "Attaque"}`,
      { subject: foundry.utils.escapeHTML(String(subject ?? "")), item: foundry.utils.escapeHTML(String(item ?? "")) })}</p>`,
    buttons
  }, { fallback: "none", awaiting: { actor, kind: "choice" } });
  const value = Number(String(picked ?? "").replace(/^v/, ""));
  if ( !String(picked ?? "").startsWith("v") || !choices.includes(value) ) return null;
  return (await useForetold(actor, value, { subject, kind })) ? { value } : null;
}

/**
 * Asks the diviner whether they replace this roll: their connected player, otherwise the active GM (from any client: the attacker
 * may be a player). Never throws: no answer = no Portent.
 * @returns {Promise<number|null>}  The noted value that replaces the d20.
 */
export async function askPortent(actor, payload) {
  const userId = rollerFor(actor) ?? game.users.activeGM?.id ?? null;
  try {
    const answer = (!userId || (userId === game.user.id)) ? await handlePortentQuery(payload)
      : await queryPlayer(game.users.get(userId), PORTENT_QUERY, payload, { timeout: PORTENT_TIMEOUT, actor, label: waitLabel("Presage") });
    return Number.isInteger(answer?.value) ? answer.value : null;
  } catch(err) {
    console.warn(`${MODULE_ID} | Portent for ${actor.name}: no answer`, err);
    return null;
  }
}

/**
 * Consults the diviners one after another for `subject`'s d20 Test; the first to accept wins (a single value replaces
 * the d20). `auto` (scenarios): "none" = nobody; "first" = the first diviner, their highest value for an ally of the subject
 * (or the subject), their lowest otherwise — without a window.
 * `declined` (optional): receives the ids of the diviners who declined, so as not to ask them again for the other targets of
 * the same save (adapter/saves.mjs).
 * @returns {Promise<{value: number, seer: string}|null>}
 */
export async function foretellFor(subject, { kind, item, auto=null, declined=null }) {
  if ( auto === "none" ) return null;
  for ( const { token, choices } of seersOf(subject, { skip: declined }) ) {
    let value = null;
    if ( auto === "first" ) {
      const friendly = (token === subject) || areAllies(token, subject);
      const wanted = friendly ? choices[0] : choices.at(-1);
      // Written here: this client must own the diviner (scenarios run on the GM's client); otherwise, no Portent
      // rather than an interrupted gate.
      try { value = (await useForetold(token.actor, wanted, { subject: subject.name, kind })) ? wanted : null; }
      catch(err) { console.warn(`${MODULE_ID} | Portent for ${token.name}: not written`, err); }
    }
    else value = await askPortent(token.actor, { actor: token.actor.uuid, subject: subject.name, kind, item });
    if ( value !== null ) return { value, seer: token.name };
    declined?.add(token.id);
  }
  return null;
}
