/**
 * §242 (issue #18): rolls requested by the GM from several characters, BG3-style.
 *
 *  - **Request** (GM): `requestGroupRoll({ actors, type, key, dc, hideDc, advantage, disadvantage, bonus, label, group })` places
 *    the dnd5e request card (`type: "request"`), one line per character, then has each one roll: the connected player who
 *    owns it receives the request on their screen (`user.query` query, like the engine's saves); this client rolls for NPCs and
 *    for characters with no connected player, without a window. Returns the promise of the final point (`viewOf`,
 *    adapter/group-roll.mjs).
 *  - **On the player's side**: before opening anything, the hook `dnd5e-combat.groupRollPrompt` (`Hooks.callAll`) lets a
 *    neighboring interface take the request over (BG3-style window): it puts the promise of its outcome in `prompt.result`
 *    (a return value would not suffice: a neighbor often listens via `Hooks.on`, which ignores it); the prompt gives it what it
 *    needs (`roll()`, `aids`, `askAid()`, `breakdown`, `signal`). With no taker, dnd5e's roll window
 *    opens, with the engine's "Aids" section (ui/skill-aid.mjs). At the delay (setting `groupRollSeconds`, 0: no limit)
 *    the window closes and the roll goes off on its own, like a Concentration saving throw (§141). Closed by the player:
 *    nothing is rolled, the card's button stays.
 *  - **Results**: each roll carries `flags.dnd5e-combat.groupRollResult` (the card) and `groupRollActor`; the active GM links it to
 *    its line of the card, one at a time. Not dnd5e's link (`flags.dnd5e.requestResult`, request-message-data.mjs:141-188): it
 *    rewrites all the lines from the local state at each roll, and two nearly simultaneous rolls would overwrite each other.
 *    At each change of the card, on each client, the hook `dnd5e-combat.groupRoll` (`Hooks.callAll`) gives the point, filtered
 *    for a player when the DC is hidden (core/group-roll.mjs `visibleTo`); `final: true` the first time everyone has rolled.
 *
 * The engine names no module: a neighbor drives via `api.rolls.request` and displays via the two hooks.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { normalizeRequest, visibleTo } from "../core/group-roll.mjs";
import {
  GROUP_FLAG, GROUP_HANDLER, rollArguments, rollMethodOf, canRoll, testTitle, keyLabel, breakdownOf, requestOf, viewOf, systemModeOf
} from "../adapter/group-roll.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { closeRollDialogAfter, inLine } from "../adapter/dialogs.mjs";
import { aidsFor, isGuided } from "../adapter/skill-aid.mjs";
import { inspirationOf, offerInspiration, offerRollBonus, keptD20 } from "../adapter/inspiration.mjs";
import { offerHeroicD20 } from "./heroic.mjs";
import { requestSkillAid } from "./skill-aid.mjs";
import { levelAtLeast } from "./levels.mjs";
import { route } from "./router.mjs";
import { log, loc, sleep, isExecutor } from "./shared.mjs";
import { markAwaiting } from "../adapter/awaiting.mjs";
import { tokenArt } from "../adapter/token-art.mjs";

export const GROUP_ROLL_QUERY = `${MODULE_ID}.groupRoll`;
export const SECONDS_SETTING = "groupRollSeconds";

/** The delay left to the player, in seconds; 0: no limit. */
const answerSeconds = () => Math.max(0, Number(game.settings.get(MODULE_ID, SECONDS_SETTING)) || 0);

/** The promises of the requests made from this client, by card id. */
const pending = new Map();
/** The cards whose final point has already been announced on this client. */
const announced = new Set();
/**
 * The requests open on this client (`carte|acteur` → `{ rolling, taken }`): if this character's roll arrives from elsewhere (the GM
 * clicked the card, another owner rolled), the window closes without rolling again — seen in play on 2026-10-24: two rolls for
 * one line.
 */
const open = new Map();
const openKey = (messageId, actorUuid) => `${messageId}|${actorUuid}`;

/* -------------------------------------------- */
/*  Demande                                     */
/* -------------------------------------------- */

/** Actors, tokens or uuids → distinct actors (an unlinked token keeps its synthetic actor). */
function actorsOf(list) {
  const out = new Map();
  for ( const entry of list ?? [] ) {
    let actor = entry;
    if ( typeof entry === "string" ) actor = fromUuidSync(entry);
    if ( actor?.actor ) actor = actor.actor;   // Token ou TokenDocument
    if ( (actor instanceof Actor) && !out.has(actor.uuid) ) out.set(actor.uuid, actor);
  }
  return [...out.values()];
}

/**
 * Places the request and has each one roll. GM only.
 * @param {object} options        The request (core/group-roll.mjs `normalizeRequest`) and:
 * @param {Array<Actor|Token|TokenDocument|string>} options.actors
 * @returns {Promise<object>}     The final point (adapter/group-roll.mjs `viewOf`), when everyone has rolled or the card is
 *   deleted (`cancelled: true`).
 */
export async function requestGroupRoll({ actors, ...input }={}) {
  if ( !game.user.isGM ) throw new Error(`${MODULE_ID} | group roll: only a GM can request rolls`);
  const { request, error } = normalizeRequest(input);
  if ( error ) throw new Error(`${MODULE_ID} | group roll: ${error}`);
  const list = actorsOf(actors).filter(a => canRoll(a, request));
  if ( !list.length ) throw new Error(`${MODULE_ID} | group roll: no character can make this roll`);

  const { message, targets, promise } = await postRequestCard(list, request);

  // The players in parallel; this client rolls for the others, without a window.
  for ( const [i, actor] of list.entries() ) {
    const userId = targets[i].user;
    if ( userId ) askPlayer(userId, message, actor);
    else await rollFor(message, actor, { configure: false }).catch(err => console.error(`${MODULE_ID} | group roll: ${actor.name} not rolled`, err));
  }
  return promise;
}

/**
 * Posts dnd5e's request card for these actors and keeps its final-tally promise on this client.
 * @returns {Promise<{message: ChatMessage, targets: object[], promise: Promise<object>}>}
 */
async function postRequestCard(list, request) {
  const targets = list.map(actor => ({ actor: actor.uuid, user: rollerFor(actor) }));
  const title = testTitle(request);
  const message = await ChatMessage.implementation.create({
    type: "request",
    speaker: { alias: title },
    content: "",
    system: { handler: GROUP_HANDLER, button: { icon: "fa-solid fa-dice-d20", label: keyLabel(request) }, targets },
    flags: { [MODULE_ID]: { [GROUP_FLAG]: request } }
  });
  const { promise, resolve } = Promise.withResolvers();
  pending.set(message.id, resolve);
  log(`group roll: ${title}${request.label ? ` (${request.label})` : ""}${request.dc !== null ? `, DC ${request.dc}${request.hideDc ? " hidden" : ""}` : ""}`
    + ` — ${list.map(a => a.name).join(", ")}`);
  return { message, targets, promise };
}

/**
 * §536: a player starts the requested-roll flow for their own characters (an inline check clicked in a journal): the same request
 * card, then the same roll window on this client (a neighbour's window through `groupRollPrompt`, else dnd5e's with the Aids
 * section). The active GM links each roll to its line, as for a GM request.
 * @param {object} options        The request (core/group-roll.mjs `normalizeRequest`) and:
 * @param {Array<Actor|Token|TokenDocument|string>} options.actors  Only those this user owns are kept.
 * @returns {Promise<object|null>}  The final tally, or null when none of these characters can roll.
 */
export async function requestOwnRoll({ actors, ...input }={}) {
  const { request, error } = normalizeRequest(input);
  if ( error ) throw new Error(`${MODULE_ID} | own roll: ${error}`);
  const list = actorsOf(actors).filter(a => a.isOwner && canRoll(a, request));
  if ( !list.length ) return null;
  const { message, promise } = await postRequestCard(list, request);
  for ( const actor of list ) {
    promptGroupRoll(message, actor).catch(err => console.error(`${MODULE_ID} | own roll: ${actor.name} not rolled`, err));
  }
  return promise;
}

/** The request to the player; if they do not answer (disconnected), this client rolls for them. */
function askPlayer(userId, message, actor) {
  const seconds = answerSeconds();
  // No limit on the player's side: the query waits an hour (they can also roll later from the card).
  const timeout = (seconds ? seconds + 30 : 3600) * 1000;
  game.users.get(userId).query(GROUP_ROLL_QUERY, { request: message.id, actor: actor.uuid }, { timeout })
    .then(answer => {
      if ( answer === "cancelled" ) log(`group roll: ${actor.name}'s player closed the roll window (the card button stays)`);
    })
    .catch(async err => {
      if ( resultOf(game.messages.get(message.id), actor) ) return;
      console.warn(`${MODULE_ID} | group roll: no answer for ${actor.name}, rolled by the GM`, err);
      await rollFor(message, actor, { configure: false }).catch(e => console.error(`${MODULE_ID} | group roll: ${actor.name} not rolled`, e));
    });
}

/** The roll already linked to this actor's line, or null. */
function resultOf(message, actor) {
  return message?.system?.targets?.find(t => t.actor === actor.uuid)?.result ?? null;
}

/**
 * dnd5e's roll for an actor of the request.
 * @param {ChatMessage} message
 * @param {Actor} actor
 * @param {{configure?: boolean, advantage?: boolean, disadvantage?: boolean}} [options]
 * @returns {Promise<ChatMessage|true|null>}  The roll's message (true if it is not readable), or null (window closed).
 */
async function rollFor(message, actor, { configure=false, advantage=false, disadvantage=false, mode=null, aids=[], flags={}, deferBonus=false }={}) {
  const request = requestOf(message);
  const method = rollMethodOf(actor, request?.type);
  if ( !method ) return null;
  const [config, messageConfig] = rollArguments(request, { requestId: message.id, actor, showDc: !request.hideDc,
    extra: { advantage, disadvantage, mode, aids }, flags });
  const rolls = await method(config, { configure }, messageConfig);
  if ( !rolls?.length ) return null;
  // dnd5e's roll returns only its `D20Roll`s: the message is found by our flags (the most recent for this actor).
  const posted = game.messages.contents.findLast(m => (m.getFlag(MODULE_ID, "groupRollResult") === message.id)
    && (m.getFlag(MODULE_ID, "groupRollActor") === actor.uuid));
  // The "after seeing the roll" dice: right away, except when the interface asks for them itself after showing the result.
  if ( posted && !deferBonus ) await bonusAfterRoll(message, actor, posted);
  return posted ?? true;
}

/**
 * The dice the creature adds after seeing its roll — an aptitude die on a check ("Ambush", "Natural Authority"…:
 * runtime/roll-bonus.mjs for free rolls), then the Bardic Inspiration it bears, "when it fails a D20 Test" (checks and saving
 * throws) — counted in the request's total: flag `groupRollBonus` `{ total, parts }` on the roll (dnd5e's roll is not rewritten).
 * DC visible: nothing on a success; DC hidden: the question does not say it (and nothing is offered on a success).
 * @returns {Promise<{added: number, parts: Array<{kind: string, value: number, helper?: string, img?: string}>}>}
 */
async function bonusAfterRoll(message, actor, posted) {
  const none = { added: 0, parts: [] };
  if ( !(posted instanceof ChatMessage) || (posted.getFlag(MODULE_ID, "groupRollPending") !== true) ) return none;
  try { return await decideBonus(message, actor, posted); }
  finally {
    // Decided (or nothing to offer): the check concludes — the card, the verdict and the GM's tracking see it now.
    await posted.setFlag(MODULE_ID, "groupRollPending", false).catch(err => console.warn(`${MODULE_ID} | group roll: result not released`, err));
  }
}

async function decideBonus(message, actor, posted) {
  const none = { added: 0, parts: [] };
  const request = requestOf(message);
  const roll = posted?.rolls?.[0];
  if ( !request || !Number.isFinite(roll?.total) || posted.getFlag(MODULE_ID, "groupRollBonus") ) return none;
  // §397: initiative has no DC — no "after seeing the roll" die is offered (the roll gives the turn order, nothing else).
  if ( request.type === "initiative" ) return none;
  const dc = request.dc;
  const shownDc = request.hideDc ? null : dc;
  const what = keyLabel(request);
  const parts = [];
  let added = 0;
  // §282: Heroic Inspiration first, before the outcome — a rerolled d20; what changes (up or down) counts in the request.
  // DC hidden: the outcome is known to the engine, not told to the player.
  const heroic = await offerHeroicD20(actor, { roll, what: (request.type === "save") ? testTitle(request) : what, needed: shownDc,
    failed: (dc === null) ? null : (roll.total < dc) });
  if ( heroic?.delta ) { added += heroic.delta; parts.push({ kind: "heroic", value: heroic.delta, img: actor.img ?? null }); }
  if ( (dc !== null) && ((roll.total + added) >= dc) ) return finish();
  // Out of combat, the player has time to read: the request's delay (at least 20 s), not that of the combat windows (10 s — seen by
  // the user: the question closed before they could use it).
  const seconds = Math.max(20, answerSeconds() || 60);
  if ( request.type !== "save" ) {
    const n = await offerRollBonus(actor, { kind: "check", what, total: roll.total + added, needed: shownDc,
      skill: request.type === "skill" ? request.key : null, d20: heroic?.kept ?? keptD20(roll), seconds });
    if ( n ) { added += n; parts.push({ kind: "feature", value: n }); }
  }
  if ( (dc === null) || ((roll.total + added) < dc) ) {
    const inspiration = inspirationOf(actor);
    const save = request.type === "save";
    const n = await offerInspiration(actor, { what: save ? testTitle(request) : what, total: roll.total + added, needed: shownDc,
      test: !save, save, seconds });
    if ( n ) {
      added += n;
      parts.push({ kind: "inspiration", value: n, helper: inspiration?.bard ?? "", img: inspiration?.source?.img ?? null });
    }
  }
  return finish();

  async function finish() {
    if ( !parts.length ) return none;
    await posted.setFlag(MODULE_ID, "groupRollBonus", { total: added, parts });
    log(`group roll: ${actor.name} adds ${added} after the roll (${parts.map(p => p.kind).join(", ")}), ${roll.total} → ${roll.total + added}`);
    return { added, parts };
  }
}

/* -------------------------------------------- */
/*  Chez celui qui lance                        */
/* -------------------------------------------- */

/** Waits for an aid's effect to be placed (the resolution goes through the active GM). */
async function untilApplied(test, ms=10000) {
  for ( let waited = 0; waited < ms; waited += 250 ) {
    if ( test() ) return true;
    await sleep(250);
  }
  return false;
}

/**
 * The request, on the client that rolls for `actor`: a neighboring interface takes it, otherwise dnd5e's roll window.
 * @returns {Promise<"rolled"|"cancelled">}
 */
export async function promptGroupRoll(message, actor) {
  if ( !requestOf(message) || !actor || resultOf(message, actor) ) return promptGroupRollNow(message, actor);
  // §381: the table sees that this roll is awaited (hourglass above the token) until it goes off, is taken elsewhere or expires.
  const seconds = answerSeconds();
  // §424: in its turn. A roll request lets the engine's question already open on this workstation go first (Reaction, saving
  // throw, refusal): it opens after, whatever interface displays it (dnd5e's window or a neighbor's fullscreen window, which has
  // its own queue and does not know the engine's). It does not hold back the following questions (`after`): its delay is long
  // (setting `groupRollSeconds`), that of a Reaction short — a Reaction that arrives during the roll opens right away, on top.
  return inLine.after(() => {
    // Rolled elsewhere during the wait (the GM rolled for them): nothing to open.
    if ( resultOf(game.messages.get(message.id) ?? message, actor) ) return "rolled";
    // §425: the wait (the hourglass, the GM Queue line) drops as soon as the dice are gone, not when the window closes — a
    // neighboring interface keeps its own open on the verdict, and the player is then no longer awaited. A question asked after
    // the roll (Heroic Inspiration, Bardic Inspiration) places its own wait.
    const release = markAwaiting(actor, "roll", { seconds: seconds > 0 ? seconds : null });
    return promptGroupRollNow(message, actor, { onRolled: release }).finally(release);
  }, `group roll: ${actor.name}`);
}

async function promptGroupRollNow(message, actor, { onRolled=null }={}) {
  const request = requestOf(message);
  if ( !request || !actor ) return "cancelled";
  if ( resultOf(message, actor) ) return "rolled";
  const seconds = answerSeconds();
  const controller = new AbortController();
  let done = null;   // the roll's message, once rolled
  const key = openKey(message.id, actor.uuid);
  const { promise: takenElsewhere, resolve: taken } = Promise.withResolvers();
  const entry = { rolling: false, taken: () => { controller.abort("taken"); closeRollDialogAfter(actor, () => {}, 0); taken("taken"); } };
  open.set(key, entry);
  const granted = [];   // the aids granted, noted on the roll (GM tracking window)
  let deferred = false;   // the interface will ask for the after-roll dice itself (`afterRoll`)
  let bonus = null;
  const afterRoll = async () => {
    if ( bonus ) return bonus;
    bonus = (done instanceof ChatMessage) ? bonusAfterRoll(message, actor, done) : Promise.resolve({ added: 0, parts: [] });
    return bonus;
  };
  const roll = async ({ advantage=false, disadvantage=false, mode=null, configure=false, flags={}, deferBonus=false }={}) => {
    if ( done ) return done;
    if ( resultOf(game.messages.get(message.id), actor) ) return null;   // already rolled elsewhere: no second roll
    entry.rolling = true;
    deferred = deferBonus;
    try { done = await rollFor(message, actor, { configure, advantage, disadvantage, mode, aids: granted, flags, deferBonus }); }
    finally { entry.rolling = !!done; }
    if ( done ) onRolled?.();
    return done;
  };
  try { return await runPrompt(); }
  finally { open.delete(key); }

  async function runPrompt() {
    const test = { skill: request.type === "skill" ? request.key : null, tool: request.type === "tool" ? request.key : null };
    const aids = ((test.skill || test.tool) && levelAtLeast("full")) ? aidsFor(actor, test) : [];
    const askedKinds = new Set();
    /**
     * What a neighboring interface receives (hook `dnd5e-combat.groupRollPrompt`). The fields:
     *  `request` (DC removed when hidden from this client), `title`, `actor`, `breakdown` (adapter/group-roll.mjs `breakdownOf`),
     *  `aids` (possible aids for a skill or tool check, adapter/skill-aid.mjs `aidsFor`), `askAid(aid)` → true if granted
     *  (Help: then pass `advantage: true` to `roll`; only one aid of each kind per roll, the second returns false),
     *  `mode`: the Advantage / Disadvantage that dnd5e will apply by itself (`{ advantage, disadvantage }`, sheet, effects,
     *  conditions), `roll({ advantage, disadvantage, mode, flags })` → the roll's message (once); `mode` "advantage" |
     *  "disadvantage" forces one or the other whatever the request and the sheet say; `flags`: other modules' flags placed on
     *  this message; `deferBonus`: the after-roll dice (Bardic Inspiration…) will wait for `afterRoll()` → `{ added, parts }`
     *  (the interface shows the result first), `deadline` (ms since the epoch, or null), `signal` (aborted at the delay — close
     *  your window, the engine rolls — or when the roll arrives from elsewhere — close your window, nothing to roll),
     *  `result` (to fill).
     */
    const prompt = {
      request: request.hideDc && !game.user.isGM ? { ...request, dc: null } : { ...request },
      title: testTitle(request), message, actor, breakdown: breakdownOf(actor, request), aids, mode: systemModeOf(actor, request),
      askAid: async aid => {
        // One aid of each kind per roll: two Help actions do not stack, a creature has only one Bardic Inspiration die at a time,
        // Advantage does not stack. A kind already requested (pending or granted) is not requested again.
        if ( askedKinds.has(aid.kind) ) return false;
        askedKinds.add(aid.kind);
        const ok = await requestSkillAid({ kind: aid.kind, helper: aid.helper, tester: aid.tester, ...test });
        if ( !ok ) askedKinds.delete(aid.kind);   // refused: another of the same kind can be requested
        else granted.push({ kind: aid.kind, helper: aid.helper.name, img: aid.token ? tokenArt(aid.token, aid.helper.img) : (aid.helper.img ?? null) });
        if ( ok && (aid.kind === "guidance") ) await untilApplied(() => isGuided(actor, test.skill));
        if ( ok && (aid.kind === "inspiration") ) await untilApplied(() => !!inspirationOf(actor));
        return ok;
      },
      roll, afterRoll, deadline: seconds ? Date.now() + (seconds * 1000) : null, signal: controller.signal, result: null
    };
    // §242: on the player who must roll, before opening the roll window: `(prompt)` (fields described above). An interface that
    // takes the request puts the promise of its outcome in `prompt.result`; with no taker, dnd5e's window opens.
    Hooks.callAll(`${MODULE_ID}.groupRollPrompt`, prompt);
    const claimed = typeof prompt.result?.then === "function";
    if ( claimed ) {
      let timer = null;
      // The delay only applies while the player has not rolled: once the dice are gone, the window waits for the end (the Bardic
      // Inspiration die offered after a failure — seen by the user: the window closed before they could use it).
      const expired = seconds ? new Promise(r => {
        const check = () => { if ( entry.rolling || done ) return; r("expired"); };
        timer = setTimeout(check, seconds * 1000);
      }) : null;
      const answer = await Promise.race([prompt.result.then(() => "answered", err => {
        console.error(`${MODULE_ID} | group roll: the roll window failed`, err);
        return "answered";
      }), takenElsewhere, ...(expired ? [expired] : [])]);
      clearTimeout(timer);
      if ( answer === "taken" ) {
        log(`group roll: ${actor.name} already rolled elsewhere, window closed`);
        return "rolled";
      }
      // The after-roll dice that the interface did not ask for (closed too early): now.
      if ( done && deferred ) await afterRoll();
      if ( answer === "expired" ) {
        controller.abort("expired");
        await roll();
        log(`group roll: ${actor.name} did not roll in time, rolled automatically`);
      }
      return done ? "rolled" : "cancelled";
    }

    // With no taker: dnd5e's window (and its "Aids" section), closed at the delay.
    let timedOut = false;
    const cancel = seconds ? closeRollDialogAfter(actor, () => { timedOut = true; }, seconds) : () => {};
    ui.notifications.info(loc("JetGroupe.Demande", { name: actor.name, test: prompt.title }));
    await roll({ configure: true });
    cancel();
    if ( !done && timedOut ) {
      await roll();
      log(`group roll: ${actor.name} did not roll in time, rolled automatically`);
    }
    return done || controller.signal.aborted ? "rolled" : "cancelled";
  }
}

/** The query, on the player's side. */
async function handleGroupRollQuery({ request: id, actor: uuid }, { user=null }={}) {
  // §472: only the GM sends this query in the game; from a player, it drops (security refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | groupRoll query from ${user.name} refused: only a GM sends it`); return "cancelled"; }
  const message = game.messages.get(id);
  const actor = await fromUuid(uuid);
  if ( !message || !actor ) return "cancelled";
  return promptGroupRoll(message, actor);
}

/** The card's button (`CONFIG.DND5E.requests`): the same window. Nothing is returned, so that dnd5e does not link the roll itself. */
async function handleCardButton(actor, message) {
  await promptGroupRoll(message, actor);
  return null;
}

/* -------------------------------------------- */
/*  Results                                     */
/* -------------------------------------------- */

let linking = Promise.resolve();

/** Active GM: links a roll to its line of the card, one at a time (each write starts from the previous write's state). */
function link(result) {
  const flag = result.getFlag(MODULE_ID, "groupRollResult");
  const actorUuid = result.getFlag(MODULE_ID, "groupRollActor");
  if ( !flag || !actorUuid ) return;
  linking = linking.then(async () => {
    const message = game.messages.get(flag);
    if ( !message ) return;
    const targets = message.system.toObject().targets ?? [];
    const index = targets.findIndex(t => t.actor === actorUuid);
    if ( (index < 0) || (targets[index].result === result.id) ) return;
    // The first roll counts: a second (the GM clicked the card while the player was rolling) does not replace the first.
    if ( targets[index].result ) {
      log(`group roll: a second roll for ${fromUuidSync(actorUuid)?.name ?? actorUuid} is ignored (the first one counts)`);
      return;
    }
    targets[index].result = result.id;
    await message.update({ "system.targets": targets });
    await initiativeFrom(message, actorUuid, result);
  }).catch(err => console.error(`${MODULE_ID} | group roll: result not linked`, err));
}

/**
 * §397: an initiative request — the total becomes the initiative of this actor's combatants in the request's combat (the active
 * combat otherwise), then dnd5e recharges what comes back on Initiative (`Combat5e#_recoverUses`, combat.mjs:86, like its own
 * roll).
 */
async function initiativeFrom(message, actorUuid, result) {
  const request = requestOf(message);
  if ( request?.type !== "initiative" ) return;
  const total = result.rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return;
  const combat = game.combats.get(request.combat ?? "") ?? game.combat;
  const mine = combat?.combatants.filter(c => (c.actor?.uuid === actorUuid) && !Number.isFinite(c.initiative)) ?? [];
  if ( !mine.length ) return;
  await combat.updateEmbeddedDocuments("Combatant", mine.map(c => ({ _id: c.id, initiative: total })));
  for ( const c of mine ) await combat._recoverUses?.({ initiative: c });
  log(`group roll: ${mine[0].name}'s initiative is ${total}`);
}

/** A card's point, announced on this client. */
function announce(message, { cancelled=false }={}) {
  const view = viewOf(message);
  if ( !view ) return;
  const final = cancelled || (view.done && !announced.has(message.id));
  if ( final ) announced.add(message.id);
  const shown = visibleTo(view, { gm: game.user.isGM });
  // §242: on each client, at each change of a requested-rolls card: the card's point (DC removed for a player when it is
  // hidden), with `final` (true once, when everyone has rolled or it is cancelled) and `cancelled`. Read-only.
  Hooks.callAll(`${MODULE_ID}.groupRoll`, { ...shown, final, cancelled });
  if ( final && pending.has(message.id) ) {
    pending.get(message.id)({ ...view, cancelled });
    pending.delete(message.id);
    if ( !cancelled ) log(`group roll: ${testTitle(view.request)} — ${view.entries.map(e => `${e.name} ${e.total}`).join(", ")}`
      + `${view.success === null ? "" : view.success ? " (success)" : " (failure)"}`);
  }
}

/**
 * GM: rolls for a character who is lagging (tracking window). Their window closes on their player's side (the roll arrives
 * from elsewhere).
 * @returns {Promise<boolean>}  true if a roll was made.
 */
export async function forceGroupRoll(messageId, actorUuid) {
  if ( !game.user.isGM ) return false;
  const message = game.messages.get(messageId);
  const actor = await fromUuid(actorUuid);
  if ( !message || !actor || resultOf(message, actor) ) return false;
  const rolled = await rollFor(message, actor, { configure: false });
  if ( rolled ) log(`group roll: ${actor.name} rolled by the GM (forced)`);
  return !!rolled;
}

/** A card's point, for a neighbor (filtered for a player when the DC is hidden). */
export function groupRollView(messageId) {
  const view = viewOf(game.messages.get(messageId));
  return view ? visibleTo(view, { gm: game.user.isGM }) : null;
}

export const rollsApi = Object.freeze({
  request: requestGroupRoll,
  view: groupRollView,
  force: forceGroupRoll,
  /**
   * The tiles of an actor's bonus for a request (`{ type, key, … }` like `request`): `[{ kind, label, value, … }]`, indicative; []
   * if the request is invalid.
   */
  breakdown: (actor, input) => {
    const { request } = normalizeRequest(input);
    return request ? breakdownOf(actor, request) : [];
  },
  /**
   * The Advantage / Disadvantage that dnd5e will give this actor by itself for the request (sheet, effects, conditions):
   * `{ advantage, disadvantage }`.
   */
  mode: (actor, input) => {
    const { request } = normalizeRequest(input);
    return request ? systemModeOf(actor, request) : { advantage: false, disadvantage: false };
  },
  /** The title of the requested check, in dnd5e's words ("Wisdom (Insight) Check"); "" if the request is invalid. */
  title: input => {
    const { request } = normalizeRequest(input);
    return request ? testTitle(request) : "";
  }
});

export function registerGroupRoll() {
  game.settings.register(MODULE_ID, SECONDS_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SECONDS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SECONDS_SETTING}.Aide`,
    scope: "world", config: true, type: Number, default: 60, range: { min: 0, max: 300, step: 5 }
  });
  CONFIG.queries[GROUP_ROLL_QUERY] = handleGroupRollQuery;   // on all clients: the player is the one who answers
  // The dnd5e card button calls `CONFIG.DND5E.requests[handler](actor, message, data, { event })` (request-message-data.mjs:136);
  // `CONFIG.DND5E` is set by the system's `init`, which runs before the modules'.
  if ( CONFIG.DND5E?.requests ) CONFIG.DND5E.requests[GROUP_HANDLER] = handleCardButton;
  // Outside, Theater of the Mind included: it is a GM tool, not a rule.
  route("createChatMessage", message => {
    if ( message.getFlag(MODULE_ID, "groupRollResult") ) {
      if ( isExecutor() ) link(message);
      return;
    }
    if ( requestOf(message) ) announce(message);
  }, { always: true, label: "group roll: result not processed" });
  route("updateChatMessage", message => {
    // A character's roll changed (Bardic Inspiration die decided, added): its card is redrawn and the point restarts.
    const cardId = message.getFlag(MODULE_ID, "groupRollResult");
    if ( cardId ) {
      const card = game.messages.get(cardId);
      if ( card ) {
        ui.chat?.updateMessage?.(card);
        announce(card);
      }
      return;
    }
    if ( !requestOf(message) ) return;
    // A request open here whose roll has just arrived from elsewhere: its window closes.
    for ( const target of message.system?.targets ?? [] ) {
      const entry = open.get(openKey(message.id, target.actor));
      if ( entry && target.result && !entry.rolling ) entry.taken();
    }
    announce(message);
  }, { always: true, label: "group roll: progress not announced" });
  route("deleteChatMessage", message => {
    if ( !requestOf(message) ) return;
    if ( !announced.has(message.id) || pending.has(message.id) ) announce(message, { cancelled: true });
  }, { always: true, label: "group roll: cancellation not announced" });
}
