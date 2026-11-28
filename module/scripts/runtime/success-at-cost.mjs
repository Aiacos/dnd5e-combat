/**
 * GitHub issue #32: "Success at a Cost", optional help from the 2024 Dungeon Master's Guide (chapter 2) — world setting, off by
 * default.
 *
 * When a d20 check misses by 1 or 2, the engine signals it to the GM alone, without a window: a badge above the token
 * (ui/success-at-cost.mjs) and a context-menu entry. The GM decides to offer the success and describes the cost in their
 * own words; the player accepts or refuses.
 *
 * Two circuits, depending on what depends on the result:
 *  - **the engine applies the result** (resolved attack, saving throw requested by a resolution): a short pause BEFORE the verdict
 *    (`successAtCostHold`, 5 s; 0 = no pause). Without a GM gesture, the failure stands. Accepted: the attack hits (never as a
 *    Critical Hit) or the saving throw succeeds, and the resolution resumes — damage and effects applied only once, since nothing
 *    has been yet;
 *  - **nothing is applied** (line of a roll requested by the GM, §242; roll from a dnd5e request card carrying a DC): a GM
 *    button on the card, with no pause or limit. Accepted: the roll is marked as succeeded (`flags.dnd5e-combat.atCost`), the
 *    card and the group's verdict count it.
 *
 * After the other helps (Heroic Inspiration, Bardic Inspiration, aptitude dice, Peerless Aim): only on what remains missed.
 * A natural 1 on an attack is never offered. Feedback to the whole table when the player accepts: card, floating text, burst,
 * sound.
 * Public hook `dnd5e-combat.successAtCost` `({ actor, kind, accepted, cost, by })` after each answer.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { atCostMarginFor, cleanCost, holdSeconds, nearMiss, AT_COST_HOLD, AT_COST_MARGIN } from "../core/success-at-cost.mjs";
import { AT_COST_QUERY, askCost, askPlayerAtCost, handleAtCostQuery } from "../adapter/success-at-cost.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";
import { route } from "./router.mjs";
import { esc, isExecutor, loc, locEsc, log, notice, say, tokenOfActor, viaActiveGM } from "./shared.mjs";

export const AT_COST_SETTING = "successAtCost";
export const AT_COST_HOLD_SETTING = "successAtCostHold";
/**
 * Issue #32: on the active GM, after each answer to an offered success: `({ actor, kind, accepted, cost, by })` — `kind` "attack",
 * "save" or "check", `cost` the cost described, `by` "player" (the player answered) or "gm" (no player connected). Read-only.
 */
export const AT_COST_HOOK = `${MODULE_ID}.successAtCost`;
/**
 * Issue #32: on the active GM, for its interface, when an opportunity (a roll narrowly missed, during the pause) opens, is
 * taken by the GM (`claimed`) or closes (`closed: true`):
 * `({ id, token, actor, name, what, total, needed, by, kind, deadline, seconds, claimed })`.
 */
export const AT_COST_CANDIDATE_HOOK = `${MODULE_ID}.successAtCostCandidate`;
const AT_COST_MARK_QUERY = `${MODULE_ID}.successAtCostMark`;

const read = (key, fallback) => { try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; } };

/** Issue #32: is the "success at a cost" rule on (world setting, off by default)? */
export const atCostEnabled = () => read(AT_COST_SETTING, false) === true;

/** The margin of help for a roll of this creature (0: nothing to offer). */
export function atCostMarginOf(actor) {
  if ( !actor || ["group", "vehicle"].includes(actor.type) ) return 0;
  return atCostMarginFor({ enabled: atCostEnabled(), isCharacter: actor.type === "character" });
}

/* -------------------------------------------- */
/*  Les occasions en attente (MJ actif)          */
/* -------------------------------------------- */

/** The opportunities open on this client, by id. */
const candidates = new Map();

const publicOf = c => ({ id: c.id, token: c.token, actor: c.actor, name: c.name, what: c.what, total: c.total, needed: c.needed, by: c.by,
  kind: c.kind, deadline: c.deadline, seconds: c.seconds, claimed: c.claimed });

/** The open opportunities (interface, menu, scenarios). */
export function atCostCandidates() {
  return [...candidates.values()].map(publicOf);
}

/** L'occasion ouverte sur ce token, ou null. */
export function atCostCandidateOn(tokenUuid) {
  return atCostCandidates().find(c => c.token === tokenUuid) ?? null;
}

function close(id, answer) {
  const c = candidates.get(id);
  if ( !c ) return;
  candidates.delete(id);
  clearTimeout(c.timer);
  Hooks.callAll(AT_COST_CANDIDATE_HOOK, { ...publicOf(c), closed: true });
  c.resolve(answer);
}

/**
 * The engine has a narrowly missed roll, whose result it is about to apply: the pause, during which the GM can offer the
 * success at a cost. Active GM. Returns `{ accepted, cost }` (accepted: the success), or null (help off, no pause, the GM did
 * nothing, failure left).
 * @param {{actor: Actor, token?: TokenDocument|null, what: string, total: number, needed: number, kind: "attack"|"save"}} data
 */
export async function holdForAtCost({ actor, token=null, what, total, needed, kind }) {
  if ( !isExecutor() || !actor ) return null;
  const by = nearMiss(total, needed, atCostMarginOf(actor));
  if ( !by ) return null;
  const seconds = holdSeconds(read(AT_COST_HOLD_SETTING, AT_COST_HOLD.byDefault));
  if ( !seconds ) return null;
  const tokenDoc = token ?? tokenOfActor(actor)?.document ?? tokenOfActor(actor) ?? null;
  const { promise, resolve } = Promise.withResolvers();
  const c = { id: foundry.utils.randomID(), token: tokenDoc?.uuid ?? null, actor: actor.uuid, name: actor.name, what, total, needed, by, kind,
    seconds, deadline: Date.now() + (seconds * 1000), claimed: false, resolve, timer: null };
  candidates.set(c.id, c);
  c.timer = setTimeout(() => { if ( !c.claimed ) close(c.id, null); }, seconds * 1000);
  log(`success at a cost: ${actor.name}, ${what} ${total} vs ${needed} (missed by ${by}) — ${seconds} s for the GM`);
  Hooks.callAll(AT_COST_CANDIDATE_HOOK, publicOf(c));
  const answer = await promise;
  if ( !answer && !c.claimed ) log(`success at a cost: not offered, ${actor.name}'s failure stands`);
  return answer?.accepted ? answer : null;
}

/** The GM lets the opportunity pass (badge closed): the failure stands, right away. */
export function dismissAtCost(id) {
  const c = candidates.get(id);
  if ( c && !c.claimed ) close(id, null);
}

/**
 * The GM takes the opportunity: the pause stops, their window describes the cost (unless `cost` is given: macro, scenario),
 * then the question to the player. Returns true if the player accepted.
 * @param {string} id
 * @param {{cost?: string}} [options]
 */
export async function offerAtCost(id, { cost }={}) {
  const c = candidates.get(id);
  if ( !c || c.claimed ) return false;
  c.claimed = true;
  clearTimeout(c.timer);
  Hooks.callAll(AT_COST_CANDIDATE_HOOK, publicOf(c));
  try {
    const answer = await proposeTo(await fromUuid(c.actor), { what: c.what, kind: c.kind, cost, total: c.total, needed: c.needed, by: c.by });
    close(id, answer);
    return !!answer?.accepted;
  } catch(err) {
    console.error(`${MODULE_ID} | success at a cost`, err);
    close(id, null);
    return false;
  }
}

/**
 * The GM's window (if `cost` is not given), the question to the player, the feedback to the table. Returns
 * `{ accepted, cost, by }`, or null if the GM left the failure.
 */
async function proposeTo(actor, { what, kind, cost, total, needed, by }) {
  if ( !actor ) return null;
  let text = cost;
  if ( text === undefined ) {
    // §381: the table sees that the GM is thinking about the cost (hourglass above the character).
    const asked = await whileAwaiting(actor, "choice", () => askCost({ name: actor.name, what, total, needed, by }));
    if ( !asked ) { log(`success at a cost: the GM keeps ${actor.name}'s failure`); return null; }
    text = asked.cost;
  }
  const price = cleanCost(text);
  const { accepted, by: decidedBy } = await askPlayerAtCost(actor, { name: actor.name, what, cost: price });
  log(`success at a cost: ${actor.name} ${accepted ? "accepts" : "declines"}${price ? ` — "${price}"` : ""}`);
  await tellTable(actor, { what, cost: price, accepted });
  Hooks.callAll(AT_COST_HOOK, { actor, kind, accepted, cost: price, by: decidedBy });
  return { accepted, cost: price, by: decidedBy };
}

/** Accepted: public card, floating text, burst and sound for everyone. Refused: a discreet floating text. */
async function tellTable(actor, { what, cost, accepted }) {
  const token = tokenOfActor(actor);
  if ( accepted ) {
    await say({ actor }, [`<i class="fa-solid fa-scale-balanced"></i> ${locEsc("APrix.Carte", { name: actor.name, what })}`,
      ...(cost ? [`<em>${locEsc("APrix.CartePrix", { cost })}</em>`] : [])], { atCostCard: { cost } });
    if ( token ) notice(token, { key: "APrix.Avis" }, "atCost", { all: true, action: "atCost", outcome: "success" });
  }
  else if ( token ) notice(token, { key: "APrix.AvisRefus" }, "ended", { all: true, action: "atCost", outcome: "failure" });
}

/* -------------------------------------------- */
/*  On a card: rolls on which nothing depends     */
/* -------------------------------------------- */

/** The DC and the total of a native dnd5e roll that can become a success at a cost; null otherwise. */
export function nativeCandidate(message) {
  if ( !message || ["attack", "damage", "healing", "usage", "request"].includes(message.type) ) return null;
  if ( message.getFlag(MODULE_ID, "groupRollResult") || message.getFlag(MODULE_ID, "atCost") ) return null;
  // A roll that the engine has itself made or used (jump, climb, lock, contest…) carries its flags: its outcome is already
  // applied, changing it afterwards would not undo it.
  if ( Object.keys(message.flags?.[MODULE_ID] ?? {}).length ) return null;
  // And only the roll of a dnd5e request card (`flags.dnd5e.requestResult`, data/chat-message/request-message-data.mjs:127,
  // documents/actor/actor.mjs:2480): the checks that the engine itself makes with a DC (climb, Hide, landing a jump…)
  // do not carry one, and their outcome is already applied.
  if ( !message.getFlag("dnd5e", "requestResult") ) return null;
  if ( ["death", "concentration"].includes(message.system?.type) ) return null;
  const roll = message.rolls?.[0];
  if ( !(roll instanceof CONFIG.Dice.D20Roll) || !Number.isNumeric(roll.options?.target) ) return null;
  // A saving throw that an engine resolution is waiting for: it has its pause, no button (nothing is undone afterwards).
  if ( message.getFlag(MODULE_ID, "inResolution") ) return null;
  const actor = message.getAssociatedActor?.() ?? null;
  const by = nearMiss(roll.total, Number(roll.options.target), atCostMarginOf(actor));
  return by ? { actor, total: roll.total, needed: Number(roll.options.target), by } : null;
}

/** The line of a roll requested by the GM (§242) that can become a success at a cost; null otherwise. */
export function rowCandidate(entry, request) {
  if ( !entry || (entry.status !== "rolled") || entry.atCost || !entry.message ) return null;
  const by = nearMiss(entry.total, request?.dc ?? null, atCostMarginOf(entry.actor));
  return by ? { actor: entry.actor, total: entry.total, needed: request.dc, by, message: entry.message } : null;
}

/**
 * The GM offers the success at a cost on a roll already placed (card button). Accepted: the roll is marked by the active GM.
 * @param {string} messageId  The roll's message.
 * @param {{what: string, cost?: string}} options
 */
export async function offerOnMessage(messageId, { what, cost }={}) {
  if ( !game.user.isGM ) return false;
  const message = game.messages.get(messageId);
  const roll = message?.rolls?.[0];
  const actor = message?.getAssociatedActor?.() ?? null;
  if ( !message || !roll || !actor || message.getFlag(MODULE_ID, "atCost") ) return false;
  const needed = Number(roll.options?.target ?? message.getFlag(MODULE_ID, "atCostDc"));
  const answer = await proposeTo(actor, { what, kind: "check", cost, total: roll.total, needed, by: needed - roll.total });
  if ( !answer?.accepted ) return false;
  await viaActiveGM(AT_COST_MARK_QUERY, markMessage, { message: messageId, cost: answer.cost }, { label: "success at a cost: roll not marked" });
  return true;
}

/** Active GM: the roll is marked as succeeded at a cost (only once). */
async function markMessage({ message: id, cost=null }, { user=null }={}) {
  // §472: only the GM sends this query in the game; from a player, it falls (safety refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | successAtCostMark query from ${user.name} refused: only a GM sends it`); return false; }
  const message = game.messages.get(id);
  if ( !message || message.getFlag(MODULE_ID, "atCost") ) return false;
  await message.setFlag(MODULE_ID, "atCost", { cost: cost ?? null });
  return true;
}

/** A line of a requested roll (§242): the DC comes from the request (the roll has no target when the DC is hidden). */
export async function offerOnRow(cardId, row, { cost }={}) {
  const card = game.messages.get(cardId);
  const result = game.messages.get(row?.message ?? "");
  if ( !game.user.isGM || !card || !result ) return false;
  // The DC comes from the request, not from the roll (it is not there when it is hidden): the roll is not rewritten.
  const actor = result.getAssociatedActor?.() ?? row.actor ?? null;
  if ( !actor || result.getFlag(MODULE_ID, "atCost") ) return false;
  const answer = await proposeTo(actor, { what: row.what, kind: "check", cost, total: row.total, needed: row.needed, by: row.needed - row.total });
  if ( !answer?.accepted ) return false;
  await viaActiveGM(AT_COST_MARK_QUERY, markMessage, { message: result.id, cost: answer.cost }, { label: "success at a cost: roll not marked" });
  return true;
}

/** The text of the "at a cost" condition under a roll (card), already escaped. */
export function atCostLabel(flag) {
  return flag?.cost ? locEsc("APrix.MarqueAvecPrix", { cost: flag.cost }) : esc(loc("APrix.Marque"));
}

export const atCostApi = Object.freeze({
  enabled: atCostEnabled,
  candidates: atCostCandidates,
  offer: offerAtCost,
  dismiss: dismissAtCost,
  offerOnMessage,
  offerOnRow,
  margin: AT_COST_MARGIN
});

export function registerSuccessAtCost() {
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  world(AT_COST_SETTING, { type: Boolean, default: false });
  world(AT_COST_HOLD_SETTING, { type: Number, default: AT_COST_HOLD.byDefault, range: { min: AT_COST_HOLD.min, max: AT_COST_HOLD.max, step: 1 } });
  CONFIG.queries[AT_COST_QUERY] = handleAtCostQuery;   // on the player who answers
  CONFIG.queries[AT_COST_MARK_QUERY] = markMessage;
  // A scene that changes: the open opportunities close (the failure stands).
  route("canvasTearDown", () => { for ( const id of [...candidates.keys()] ) dismissAtCost(id); }, { label: "success at a cost: not cleared" });
}
