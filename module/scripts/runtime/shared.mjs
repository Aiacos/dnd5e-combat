/** What the whole runtime shares (SPEC §13, S1): a single definition of each thing. */

import { MODULE_ID } from "../constants.mjs";
import { actionSound, noticeText } from "../core/action-feedback.mjs";

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

/**
 * §252: on each client that must show an engine notice above a token (refusal, prompt, return of an action): `({ token, text,
 * kind })` — `token` a uuid, `text` already translated. The engine's interface writes it as floating text.
 */
export const NOTICE_HOOK = `${MODULE_ID}.notice`;
/**
 * §252: on the acting client, for an action seen by the whole table, just before playing its sound: `({ token, action,
 * outcome, kind, text, sound })`. Cancellable: `false` prevents the sound only (the floating text already went out to everyone).
 */
export const FEEDBACK_HOOK = `${MODULE_ID}.feedback`;
/** §252: the query that makes a notice be drawn on another client (ui/feedback.mjs registers it). */
export const NOTICE_QUERY = `${MODULE_ID}.notice`;

/**
 * An engine notice above a token (refusal, prompt: "Already targeted", "Too far"), on this client: published for the
 * interface (ui/feedback.mjs), which writes it as scrolling text. The runtime does not know the interface.
 *
 * §252 (DAS rules of 2026-10-27): `all: true` makes it the feedback of an **action** for the whole table — the text is drawn on
 * every connected client (`NOTICE_QUERY` query) and a sound is played for everyone. `text` can then be `{ key, data }` (key
 * without the `DND5ECOMBAT.` prefix), translated on each client. The sound: `sound` if given (null: none), otherwise the one
 * for `action` / `outcome` (core/action-feedback.mjs). Before playing it, the public hook `dnd5e-combat.feedback`
 * `({ token, action, outcome, kind, text, sound })` is called on this client only (`Hooks.call`): a neighbouring module that
 * plays its own animation and sound returns `false`, and the engine stays silent. Refusals and prompts stay local (`all` false).
 */
export function notice(token, text, kind="refused", { all=false, gmOnly=false, action=null, outcome=null, sound=undefined }={}) {
  const uuid = token?.uuid ?? token?.document?.uuid ?? token ?? null;
  if ( !uuid ) return;
  Hooks.callAll(NOTICE_HOOK, { token: uuid, text: noticeText(text, loc), kind });
  if ( !all ) return;
  // Issue #178: `gmOnly` — the text goes to the GMs only, and the sound stays on this machine.
  for ( const user of game.users ) {
    if ( !user.active || user.isSelf || (gmOnly && !user.isGM) ) continue;
    user.query(NOTICE_QUERY, { token: uuid, text, kind }, { timeout: 5000 }).catch(() => {});
  }
  const src = (sound === undefined) ? actionSound(action, outcome) : sound;
  const allowed = Hooks.call(FEEDBACK_HOOK, { token: uuid, action, outcome, kind, text: noticeText(text, loc), sound: src });
  if ( (allowed !== false) && src ) foundry.audio.AudioHelper.play({ src, volume: 0.8, loop: false }, !gmOnly)?.catch?.(() => {});
}

/** §252: on another client, the notice that an action of the table shows it (`NOTICE_QUERY` query). */
export function receiveNotice({ token, text, kind }={}) {
  if ( token ) Hooks.callAll(NOTICE_HOOK, { token, text: noticeText(text, loc), kind });
  return true;
}

/** A text escaped for HTML (actor names, item names…). */
export const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/** A translation whose inserted texts (actor names, item names…) are escaped: for a chat card. */
export const locEsc = (key, data={}) =>
  loc(key, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (typeof v === "string") ? esc(v) : v])));

/**
 * An engine chat card: one line per paragraph (`lines`, already-safe HTML — `locEsc` to put names in it), spoken by
 * `speaker` (`{ actor }` or `{ token }` for `getSpeaker`, or `{ alias }`), with its engine `flags` and, if needed, as a whisper
 * (`whisper`: user ids).
 */
export function say(speaker, lines, flags=null, { whisper=null }={}) {
  const data = {
    speaker: ("alias" in speaker) ? speaker : ChatMessage.implementation.getSpeaker(speaker),
    content: [lines].flat().map(line => `<p>${line}</p>`).join("")
  };
  if ( flags ) data.flags = { [MODULE_ID]: flags };
  if ( whisper ) data.whisper = whisper;
  return ChatMessage.implementation.create(data);
}

/** Attendre `ms` millisecondes. */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const loc = (key, data) => data ? game.i18n.format(`DND5ECOMBAT.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.${key}`);

/** SPEC §5.3: the active GM is the sole executor of the engine. */
export function isExecutor() {
  return game.users.activeGM?.isSelf === true;
}

/**
 * Run `handler(payload)` on the active GM: here if we are that GM, otherwise through the `query` request
 * (`CONFIG.queries`). Without an active GM: the `noGm` warning (translation key, if there is one) and `fallback`. A request
 * with no answer (timeout, error) returns `fallback`, logged under `label` if given. An error in the local handling, however,
 * propagates.
 * @param {string} query
 * @param {(payload: object) => any} handler
 * @param {object} payload
 * @param {{timeout?: number, noGm?: string|null, fallback?: any, label?: string|null}} [options]
 */
export async function viaActiveGM(query, handler, payload, { timeout=10000, noGm=null, fallback=null, label=null }={}) {
  const gm = game.users.activeGM;
  if ( !gm ) {
    if ( noGm ) ui.notifications.warn(loc(noGm));
    return fallback;
  }
  if ( gm.isSelf ) return handler(payload);
  return gm.query(query, payload, { timeout }).catch(err => {
    if ( label ) console.warn(`${MODULE_ID} | ${label}`, err);
    return fallback;
  });
}

/**
 * An act on a document: here if this client owns it (`isOwner`), otherwise through the active GM (`query`), without a
 * warning. No active GM, or no answer: `fallback`.
 */
export async function viaOwnerOrGM(isOwner, query, handler, payload, { timeout=10000, fallback=null }={}) {
  if ( isOwner ) return handler(payload);
  const gm = game.users.activeGM;
  if ( !gm ) return fallback;
  return gm.query(query, payload, { timeout }).catch(() => fallback);
}

/** Beyond that, we rule without waiting for the canvas (and we say so). */
export const CANVAS_WAIT_MAX_MS = 5000;

/**
 * Waits until the canvas has finished drawing (change of level or scene: the V14 core
 * redraws everything, `canvas.ready` false during the redraw). Bounded. No global: testable.
 * @param {object} ports
 * @param {() => boolean} ports.isReady
 * @param {(ms: number) => Promise} ports.sleep
 * @param {number} [maxMs]
 * @param {number} [stepMs]
 * @returns {() => Promise<boolean>}  true: ready (immediately or after waiting); false: not ready in time.
 */
export function createCanvasWait({ isReady, sleep }, maxMs=CANVAS_WAIT_MAX_MS, stepMs=50) {
  return async function whenCanvasReady() {
    for ( let waited = 0; !isReady(); waited += stepMs ) {
      if ( waited >= maxMs ) return false;
      await sleep(stepMs);
    }
    return true;
  };
}

export const whenCanvasReady = createCanvasWait({
  isReady: () => !!globalThis.canvas?.ready,
  sleep
});

/** Beyond that, we go on without the 3D dice: an animation that does not play does not hold up the game. */
export const DICE_WAIT_MAX_MS = 8000;

/**
 * Principle 2: nothing applies before the dice have stopped. The 3D dice (Dice So Nice, Dicer…) stay optional,
 * and waiting for them is bounded (SPEC §12, blockage seen on 2026-09-22): `waitFor3DAnimationByMessageID`
 * only returns at the message's `diceSoNiceRollComplete` hook (main.js, 6.2.9), which
 * never comes if rendering is suspended — background window, hidden tab. No global: testable.
 * @param {object} ports
 * @param {(id: string) => Promise|null} ports.animation  Wait for a message's animation; null if there are no 3D dice.
 * @param {() => boolean} ports.isHidden                  Is the window not rendering?
 * @param {(ms: number) => Promise} ports.sleep
 * @param {(why: string) => void} [ports.report]          Records that we went on without waiting.
 * @param {number} [maxMs]
 */
export function createDiceWait({ animation, isHidden, sleep, report=() => {} }, maxMs=DICE_WAIT_MAX_MS) {
  return async function waitForDice(message) {
    if ( isHidden() ) return report("window in the background");   // without rendering, the animation will not play
    const pending = animation(message.id);
    if ( !pending ) return;
    const outcome = await Promise.race([pending.then(() => "done"), sleep(maxMs).then(() => "late")]);
    if ( outcome === "late" ) report(`over ${maxMs} ms`);
  };
}

/**
 * #286: the wait for one message's 3D dice, from whatever module provides Dice So Nice's API (`game.dice3d`): Dice So Nice, Dicer…
 * Recognised by the function, not by the module id (Dicer cannot run beside Dice So Nice, so a `dice-so-nice` check never waited
 * for it). null when no such API is there: no 3D dice, no wait.
 * @param {object|undefined} dice3d  `game.dice3d`, read at call time.
 * @returns {(id: string) => Promise|null}
 */
export const dice3dAnimation = dice3d => id => dice3d?.waitFor3DAnimationByMessageID?.(id) ?? null;

export const waitForDice = createDiceWait({
  animation: id => dice3dAnimation(game.dice3d)(id),
  isHidden: () => document.hidden === true,
  sleep,
  report: why => log(`3D dice: continuing without waiting (${why})`)
});

/**
 * §252: make a dnd5e roll (`roll`, which returns its rolls) then wait for the 3D dice of its message to finish
 * (`waitForDice`, bounded) before returning — the verdict only goes out after. dnd5e only returns the rolls: the message is
 * the last roll message of this client created during the roll.
 */
export async function rolledAndShown(roll) {
  const known = new Set(game.messages.keys());
  const rolls = await roll();
  const message = game.messages.contents.findLast(m => !known.has(m.id) && m.isAuthor && m.rolls?.length);
  if ( message ) await waitForDice(message);
  return rolls;
}

/** Le token (document) d'un acteur : celui d'un acteur de token, sinon le premier actif. */
export const tokenOfActor = actor => actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
