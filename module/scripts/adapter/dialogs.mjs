/**
 * Combat windows do not hold up the game (table rule, requested by the user on
 * 2026-09-23): Reaction, save choice, effect choice, a player's saving throw — at the end of the
 * timeout (10 s by default, world setting `combatWindowSeconds`), they resolve on their own. A visible
 * countdown says so.
 *
 * On the core's `DialogV2.wait` (client/applications/api/dialog.mjs:405): `render` gives the window (the
 * counter, closing at the end of the timeout), `close` chooses what a closed window returns — the default
 * answer if the timeout closed it, null otherwise.
 *
 * §290: world setting `combatWindowUnlimited` — windows have no timeout, the player takes their time, and the GM sees who they are
 * waiting for (ui/player-waits.mjs); "Force" does on the player's client what the timeout would have done
 * (`forceOpenWindows`). A timeout given explicitly (rolls requested by the GM, §242) is not touched.
 */

import { MODULE_ID } from "../constants.mjs";
import { markAwaiting } from "./awaiting.mjs";
import { createWindowLine } from "../core/window-line.mjs";

/** Combat window timeout, in seconds. */
export function combatWindowSeconds() {
  try { return Math.max(3, Number(game.settings.get(MODULE_ID, "combatWindowSeconds")) || 10); }
  catch { return 10; }
}

/** §290: are combat windows without timeout (the GM forces)? */
export function windowsUnlimited() {
  try { return !!game.settings.get(MODULE_ID, "combatWindowUnlimited"); }
  catch { return false; }
}

/** §290: on this client, what the timeout would do to each window opened without timeout. */
const forcers = new Set();

/** §290: the GM forces — each combat window open on this client resolves as at the end of the timeout. Returns their number. */
export function forceOpenWindows() {
  const all = [...forcers];
  forcers.clear();
  for ( const force of all ) {
    try { force(); }
    catch(err) { console.warn(`${MODULE_ID} | forced window`, err); }
  }
  return all.length;
}

/**
 * At the end of the timeout (`ms`), or when the GM forces if windows have no timeout: `expire`.
 * Returns the function that disarms.
 * @param {Function} expire
 * @param {number} ms
 * @param {boolean} [unlimited]  Without timeout (default: the setting).
 */
export function expireLater(expire, ms, unlimited=windowsUnlimited()) {
  // §381: the GM can also force a timed window (token menu); it then resolves right away, as at the end of the timeout.
  let done = false;
  const once = () => { if ( done ) return; done = true; forcers.delete(once); clearTimeout(timer); expire(); };
  const timer = unlimited ? null : setTimeout(once, ms);
  forcers.add(once);
  return () => { done = true; clearTimeout(timer); forcers.delete(once); };
}

const countdownText = n => game.i18n.format("DND5ECOMBAT.Delai.Auto", { n });

/* -------------------------------------------- */
/*  §422: the windows open on this station       */
/* -------------------------------------------- */

/**
 * §422: on this client, when an engine window opens or closes there: `(prompts)`, `[{ id, awaitingId, actor, title, text,
 * buttons: [{ action, label, icon }], since }]`. Local: nothing is broadcast (a window's text does not leave the station
 * where it is open). The GM Queue uses it to answer from its panel; the same list: `localPrompts()`.
 */
export const PROMPTS_HOOK = `${MODULE_ID}.localPrompts`;

const prompts = new Map();

/** The engine windows open on this station, the oldest first. */
export function localPrompts() {
  return [...prompts.values()].map(({ choose, ...p }) => p).sort((a, b) => a.since - b.since);
}

/** Answers window `id` by clicking its `action` button — exactly what the mouse would do. Returns false if it no longer exists. */
export function answerPrompt(id, action) {
  return prompts.get(id)?.choose(action) ?? false;
}

/**
 * The text of an HTML fragment, read in an **inert** document (`DOMParser`): nothing in it loads or runs (§471). Any reading of
 * the text of HTML we did not write ourselves goes through here (guardian `texte-inerte`, tests/das-tests.json).
 * @param {string} html
 * @returns {string}
 */
export function htmlText(html) {
  const body = new DOMParser().parseFromString(String(html ?? ""), "text/html").body;
  return (body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function trackPrompt(dialog, config, { awaitingId=null, actor=null }={}) {
  const id = awaitingId ?? foundry.utils.randomID();
  prompts.set(id, {
    id, awaitingId, actor: actor?.uuid ?? null, title: config.window?.title ?? "", text: htmlText(config.content),
    buttons: (config.buttons ?? []).map(b => ({ action: b.action, label: b.label ?? b.action, icon: b.icon ?? null })), since: Date.now(),
    choose: action => {
      const button = [...(dialog.element?.querySelectorAll("button[data-action]") ?? [])].find(b => b.dataset.action === action);
      if ( !button ) return false;
      button.click();
      return true;
    }
  });
  Hooks.callAll(PROMPTS_HOOK, localPrompts());
  return () => { if ( prompts.delete(id) ) Hooks.callAll(PROMPTS_HOOK, localPrompts()); };
}

/** §422: the "N more requests after" line of an open window — what waits its turn in this station's queue. */
const QUEUED = `<p class="dnd5e-combat-queued" hidden></p>`;
function showQueued(dialog) {
  const line = dialog.element?.querySelector(".dnd5e-combat-queued");
  if ( !line ) return;
  const n = inLine.waiting();
  line.hidden = n === 0;
  line.textContent = n ? game.i18n.format(`DND5ECOMBAT.File.${n === 1 ? "EnsuiteUne" : "Ensuite"}`, { n }) : "";
}

/**
 * §422: a window WITHOUT timeout (a GM decision, a refusal), tracked like the others — its line in the GM Queue with its buttons,
 * and the broadcast wait (`awaiting`) while it is open. `aside`: it goes after the current question on this station, without
 * holding back the following ones (core/window-line.mjs, `after`).
 * @param {object} config  Configuration of `DialogV2.wait`.
 * @param {{awaiting?: {actor: Actor|null, kind: string, token?: object}|null, aside?: boolean}} [options]
 * @returns {Promise<*>}  The chosen button; null if it is closed.
 */
export function promptWait(config, { awaiting=null, aside=false }={}) {
  const open = () => {
    const release = awaiting ? markAwaiting(awaiting.actor ?? null, awaiting.kind,
      { token: awaiting.token ?? null, label: config?.window?.title ?? null }) : null;
    let untrack = () => {};
    return foundry.applications.api.DialogV2.wait({
      ...config,
      rejectClose: false,
      render: (event, dialog) => { untrack(); untrack = trackPrompt(dialog, config, { awaitingId: release?.id ?? null, actor: awaiting?.actor ?? null }); }
    }).finally(() => { untrack(); release?.(); });
  };
  return aside ? inLine.after(open, `promptWait: ${config?.window?.title ?? ""}`) : open();
}

/**
 * A button window that resolves itself when the delay runs out.
 * @param {object} config           `DialogV2.wait` configuration (window, content, buttons…).
 * @param {object} [options]
 * @param {*} [options.fallback]    What the window returns if the delay closed it (a button's action…).
 * @param {number} [options.seconds]  Its own delay; without it, the world setting (§290: may be no delay).
 * @param {boolean} [options.front]  §282: the window comes in front of the others when it opens.
 * @param {{actor: Actor|null, kind: string, token?: object}|null} [options.awaiting]  §381: the table sees this creature awaited
 *   (hourglass above its token) while the window is open.
 * @returns {Promise<*>}  The chosen button; `fallback` when the delay runs out (or forced by the GM); null if it is closed by hand.
 */
export function timedWait(config, { fallback=null, seconds=null, front=false, awaiting=null }={}) {
  const unlimited = (seconds === null) && windowsUnlimited();
  const shown = unlimited ? null : (seconds ?? combatWindowSeconds());
  // §401: in turn — the window opens when the previous one of this seat is closed; its countdown starts when it opens.
  return inLine(() => {
    const release = awaiting ? markAwaiting(awaiting.actor ?? null, awaiting.kind,
      { seconds: shown, token: awaiting.token ?? null, label: config?.window?.title ?? null }) : null;   // §426: the title, for GMs
    const track = { awaitingId: release?.id ?? null, actor: awaiting?.actor ?? null };
    const waiting = unlimited ? waitForForce(config, { fallback, front, track }) : countdownWait(config, { fallback, seconds: shown, front, track });
    return release ? waiting.finally(release) : waiting;
  }, `timedWait: ${config?.window?.title ?? ""}`);
}

/**
 * §401: the queue of windows of this seat (core/window-line.mjs) — the engine's questions chain up instead of piling up. A window
 * waits for the previous one only for a bounded time (the windows' delay and 3 s; 30 s when they have no delay): beyond that,
 * it opens anyway, so that a question depending on another one left open never blocks the game.
 */
export const inLine = createWindowLine({ capMs: () => (windowsUnlimited() ? 30000 : (combatWindowSeconds() + 3) * 1000) });

/** The countdown bar of a timed window (styles: `.dnd5e-combat-countdown`). */
const countdownMarkup = left => `<div class="dnd5e-combat-countdown" data-level="high">
    <div class="track"><div class="bar"></div></div><span class="label">${countdownText(left)}</span></div>`;

/** Paints the countdown bar found in `element` for `left` seconds out of `seconds`. */
function paintCountdown(element, left, seconds) {
  const root = element?.querySelector(".dnd5e-combat-countdown");
  if ( !root ) return;
  const ratio = Math.max(0, left - 1) / seconds;
  root.querySelector(".bar")?.style.setProperty("transform", `scaleX(${ratio})`);
  root.dataset.level = ratio > 0.6 ? "high" : ratio > 0.3 ? "mid" : "low";
  const label = root.querySelector(".label");
  if ( label ) label.textContent = countdownText(left);
}

/**
 * #173 (§557): the same countdown bar in a window DAS did not build (dnd5e's damage dialog), for the combat window delay — the window
 * itself is closed by `closeRollDialogAfter`, armed at the same moment. Inserted before `before` (a selector, else at the end of the
 * window's content); put back if a render removed it. Nothing when the windows have no delay. Returns the function that stops it.
 * @param {ApplicationV2} app
 * @param {{before?: string}} [options]
 */
export function showCountdown(app, { before=null }={}) {
  if ( windowsUnlimited() ) return () => {};
  const seconds = combatWindowSeconds();
  if ( !(seconds > 0) ) return () => {};
  let left = seconds;
  const mount = () => {
    const host = app.element?.querySelector(".window-content") ?? app.element;
    if ( !host || host.querySelector(".dnd5e-combat-countdown") ) return;
    const anchor = before ? host.querySelector(before) : null;
    if ( anchor ) anchor.insertAdjacentHTML("beforebegin", countdownMarkup(left));
    else host.insertAdjacentHTML("beforeend", countdownMarkup(left));
  };
  mount();
  requestAnimationFrame(() => paintCountdown(app.element, left, seconds));   // after the first paint, for the transition
  const timer = setInterval(() => {
    left = Math.max(0, left - 1);
    mount();
    paintCountdown(app.element, left, seconds);
    if ( left <= 0 ) clearInterval(timer);
  }, 1000);
  return () => clearInterval(timer);
}

/** A window with a countdown: `fallback` after `seconds`. */
function countdownWait(config, { fallback, seconds, front, track={} }) {
  let left = seconds;
  let timer = null;
  let timedOut = false;
  let disarm = () => {};
  let untrack = () => {};
  // Progress bar driven by the same timer as the closing (a CSS animation over the duration
  // drifts from it in a background tab): every second, it heads toward the value of the
  // next second, with a one-second transition — smooth, and empty when the window closes.
  const update = dialog => paintCountdown(dialog.element, left, seconds);
  const countdown = countdownMarkup(left);
  return foundry.applications.api.DialogV2.wait({
    ...config,
    classes: [...(config.classes ?? []), "dnd5e-combat-timed"],
    content: `${config.content ?? ""}${countdown}${QUEUED}`,
    rejectClose: false,
    render: (event, dialog) => {
      if ( front ) dialog.bringToFront?.();
      if ( timer ) return;
      untrack = trackPrompt(dialog, config, track);
      showQueued(dialog);
      // §381: the GM forces (token menu) — as when the delay runs out.
      disarm = expireLater(() => { clearInterval(timer); timedOut = true; dialog.close(); }, 0, true);
      requestAnimationFrame(() => update(dialog));   // after the first paint, otherwise no transition
      timer = setInterval(() => {
        left -= 1;
        update(dialog);
        showQueued(dialog);
        if ( left > 0 ) return;
        clearInterval(timer);
        timedOut = true;
        dialog.close();
      }, 1000);
    },
    close: () => {
      clearInterval(timer);
      disarm();
      untrack();
      return timedOut ? fallback : null;
    }
  });
}

/** §290: a window without delay — it waits for the player; the GM can force it (it then returns `fallback`). */
function waitForForce(config, { fallback, front, track={} }) {
  let forced = false;
  let disarm = () => {};
  let untrack = () => {};
  let queued = null;
  const waiting = `<p class="dnd5e-combat-waiting"><i class="fa-solid fa-hourglass-half"></i> ${game.i18n.localize("DND5ECOMBAT.Attente.Joueur")}</p>`;
  return foundry.applications.api.DialogV2.wait({
    ...config,
    classes: [...(config.classes ?? []), "dnd5e-combat-timed"],
    content: `${config.content ?? ""}${waiting}${QUEUED}`,
    rejectClose: false,
    render: (event, dialog) => {
      if ( front ) dialog.bringToFront?.();
      untrack();
      untrack = trackPrompt(dialog, config, track);
      showQueued(dialog);
      clearInterval(queued);
      queued = setInterval(() => showQueued(dialog), 1000);
      disarm();
      disarm = expireLater(() => { forced = true; dialog.close(); }, 0, true);
    },
    close: () => {
      disarm();
      untrack();
      clearInterval(queued);
      return forced ? fallback : null;
    }
  });
}

/**
 * Closes the dnd5e roll window of an actor (a player's saving throw) when the delay runs out; returns
 * a function to cancel the timer. `onTimeout` is called if the delay is what closed it.
 * §290: without its own delay and with no-delay windows, the GM closes it by forcing.
 * §381: `awaiting` (a kind, "roll") — the table sees that this roll is awaited while the timer has neither expired nor been
 * cancelled.
 */
export function closeRollDialogAfter(actor, onTimeout, seconds=null, { awaiting=null }={}) {
  const unlimited = (seconds === null) && windowsUnlimited();
  seconds ??= combatWindowSeconds();
  // §381: the table sees that this roll is awaited, until it is made or the window is closed.
  const release = (awaiting && (seconds > 0)) ? markAwaiting(actor, awaiting, { seconds: unlimited ? null : seconds }) : () => {};
  const disarm = expireLater(() => {
    release();
    const Dialog = globalThis.dnd5e?.applications?.dice?.RollConfigurationDialog;
    for ( const app of foundry.applications.instances.values() ) {
      if ( !(app instanceof Dialog) || !app.rendered ) continue;
      const subject = app.config?.subject;
      if ( (subject === actor) || (subject?.uuid === actor.uuid) || (subject?.actor === actor) ) {
        onTimeout();
        app.close();
      }
    }
  }, seconds * 1000, unlimited);
  return () => { release(); disarm(); };
}
