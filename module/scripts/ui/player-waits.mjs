/**
 * §421: the "GM Queue" panel (the old tracking window of §290) — in three parts: what the engine asks of the GM, the players
 * it is waiting for (who, for which character, what, for how long, "Force"), and the actions blocked by a departed author
 * ("Cast in their place"). The queue itself: runtime/gm-queue.mjs.
 *
 * It opens by itself for a GM when the game is held up: a blocked action, or a player awaited beyond the combat windows'
 * delay (possible only when they have no delay — with a delay, they resolve by themselves). It closes when nothing is left;
 * `api.queue.open()` (or `api.waits.open()`) reopens it. The GM's windows keep opening as before: the panel keeps
 * the list, it does not replace them.
 */

import { GM_QUEUE_HOOK, queue, refreshQueue, forceLine, rollBlocked, answerLine } from "../runtime/gm-queue.mjs";
import { combatWindowSeconds, windowsUnlimited } from "../adapter/dialogs.mjs";
import { openTracker } from "./group-roll-tracker.mjs";
import { route } from "../runtime/router.mjs";
import { loc, esc } from "../runtime/shared.mjs";

const WINDOW_ID = "das-player-waits";
/** The rows the GM dismissed by closing the panel (it does not reopen for them). */
const dismissed = new Set();
let tick = null;
let opener = null;

const elapsed = since => Math.max(0, Math.round((Date.now() - since) / 1000));
/** The name and image of a row's character (read on this client: the row only carries its uuid). */
const actorOf = line => (line.actor ? fromUuidSync(line.actor, { strict: false }) : null);
const what = line => line.label || loc(`File.Sorte.${line.kind}`);

function row(line, button) {
  const actor = actorOf(line);
  return `<li class="das-wait">
    <img src="${esc(actor?.img ?? "icons/svg/mystery-man.svg")}" alt="">
    <div class="das-wait__text"><strong>${esc(line.userName)}</strong>${actor?.name ? ` <span class="das-muted">(${esc(actor.name)})</span>` : ""}
      <small>${esc(what(line))}</small></div>
    <span class="das-wait__time" data-since="${line.since}">${esc(loc("Attente.Depuis", { n: elapsed(line.since) }))}</span>
    ${button}
  </li>`;
}

/**
 * §422: a request made to the GM — the creature concerned first (the GM knows it is them: their account name tells nothing),
 * what the window asks, and its buttons: clicking here is clicking in the window. Without a window known to this workstation (a
 * request open at another GM's), the row alone.
 */
function mineRow(line) {
  const actor = actorOf(line);
  const title = actor?.name ?? loc("File.MJ");
  const buttons = (line.prompt?.buttons ?? []).map(b => `<button type="button" data-action="answer" data-id="${esc(line.id)}" data-choice="${esc(b.action)}">
    ${b.icon ? `<i class="${esc(b.icon)}"></i>` : ""}${esc(b.label)}</button>`).join("");
  return `<li class="das-wait das-wait--mine">
    <img src="${esc(actor?.img ?? "icons/svg/mystery-man.svg")}" alt="">
    <div class="das-wait__text"><strong>${esc(title)}</strong>
      <small>${esc(line.prompt?.text || what(line))}</small></div>
    <span class="das-wait__time" data-since="${line.since}">${esc(loc("Attente.Depuis", { n: elapsed(line.since) }))}</span>
    ${buttons ? `<div class="das-wait__answers">${buttons}</div>`
      : `<span class="das-muted das-wait__note" data-tooltip="${esc(loc("File.MaFenetre"))}"><i class="fa-solid fa-window-restore"></i></span>`}
  </li>`;
}

/**
 * §423: a roll request (§242) — a single row: the check, how many characters are awaited, and the link to "Rolls in
 * progress", the window that shows the detail. "Roll for those who are slow" does here what the tracking button does.
 */
function groupRow(line) {
  return `<li class="das-wait das-wait--mine">
    <img src="icons/svg/d20-highlight.svg" alt="">
    <div class="das-wait__text"><strong>${esc(line.label)}</strong>
      <small>${esc(loc(line.count === 1 ? "File.AttenduUn" : "File.Attendus", { count: line.count }))}${line.userName ? ` — ${esc(line.userName)}` : ""}</small></div>
    <span class="das-wait__time" data-since="${line.since}">${esc(loc("Attente.Depuis", { n: elapsed(line.since) }))}</span>
    <div class="das-wait__answers">
      <button type="button" data-action="tracker"><i class="fa-solid fa-dice-d20"></i>${esc(loc("File.VoirSuivi"))}</button>
      <button type="button" data-action="force" data-id="${esc(line.id)}"><i class="fa-solid fa-forward"></i>${esc(loc("JetGroupe.Suivi.LancerTous", { count: line.count }))}</button>
    </div>
  </li>`;
}

let WaitsClass = null;
const WaitsApp = () => WaitsClass ??= class PlayerWaits extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: WINDOW_ID,
    classes: ["das-player-waits"],
    window: { icon: "fa-solid fa-list-check", resizable: true },
    position: { width: 440, height: "auto" },
    actions: { force: PlayerWaits.#force, forceAll: PlayerWaits.#forceAll, roll: PlayerWaits.#roll, answer: PlayerWaits.#answer, tracker: PlayerWaits.#tracker }
  };

  get title() {
    return loc("Attente.Titre");
  }

  async _renderHTML() {
    const q = queue();
    if ( !q.count ) return `<p class="das-muted">${esc(loc("Attente.Aucune"))}</p>`;
    const section = (title, rows) => (rows.length ? `<h4 class="das-queue__title">${esc(loc(title))}</h4><ul class="das-waits">${rows.join("")}</ul>` : "");
    const mine = q.mine.map(mineRow);
    // §422: a requested roll (§242) — the button is that of the roll tracking window, "Roll for them".
    const players = q.players.map(l => (l.source === "group") ? groupRow(l) : row(l, l.groupRoll
      ? `<button type="button" data-action="force" data-id="${esc(l.id)}"><i class="fa-solid fa-dice-d20"></i>${esc(loc("JetGroupe.Suivi.LancerPour", { name: actorOf(l)?.name ?? l.userName }))}</button>`
      : `<button type="button" data-action="force" data-id="${esc(l.id)}" data-tooltip="${esc(loc("Attente.ForcerAide"))}">
      <i class="fa-solid fa-forward"></i>${esc(loc("Attente.Forcer"))}</button>`));
    const blocked = q.blocked.map(b => `<li class="das-wait das-wait--blocked">
      <img src="${esc(actorOf(b)?.img ?? "icons/svg/mystery-man.svg")}" alt="">
      <div class="das-wait__text"><strong>${esc(loc("File.Parti", { name: b.userName }))}</strong>
        <small>${esc(loc(b.heal ? "File.Soin" : "File.Jet", { item: b.item }))}${b.actorName ? ` — ${esc(b.actorName)}` : ""}</small></div>
      <button type="button" data-action="roll" data-id="${esc(b.id)}" data-tooltip="${esc(loc("File.LancerAide"))}">
        <i class="fa-solid fa-dice-d20"></i>${esc(loc("File.Lancer"))}</button>
    </li>`);
    const all = q.players.length > 1 ? `<footer><button type="button" data-action="forceAll"><i class="fa-solid fa-forward-fast"></i>
      ${esc(loc("Attente.ForcerTout", { count: q.players.length }))}</button></footer>` : "";
    return `${section("File.Bloque", blocked)}${section("File.Moi", mine)}${section("File.Joueurs", players)}${all}`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender() {
    // The toolbar badge always says what the panel lists.
    showCount(queue());
    // The waiting time advances every second, without redrawing everything.
    clearInterval(tick);
    tick = setInterval(() => {
      for ( const el of this.element?.querySelectorAll(".das-wait__time") ?? [] ) {
        el.textContent = loc("Attente.Depuis", { n: elapsed(Number(el.dataset.since)) });
      }
    }, 1000);
  }

  _onClose() {
    clearInterval(tick);
    tick = null;
    const q = queue();
    for ( const l of [...q.players, ...q.blocked] ) dismissed.add(l.id);
  }

  static async #force(event, target) {
    target.disabled = true;
    await forceLine(target.dataset.id);
  }

  static async #forceAll(event, target) {
    target.disabled = true;
    for ( const l of queue().players ) await forceLine(l.id);
  }

  static async #roll(event, target) {
    target.disabled = true;
    await rollBlocked(target.dataset.id);
  }

  static #tracker() {
    openTracker();
  }

  static #answer(event, target) {
    target.disabled = true;
    answerLine(target.dataset.id, target.dataset.choice);
  }
};

/** Opens (or brings to the front) the "GM Queue" panel, GM only. */
export function openPlayerWaits() {
  if ( !game.user.isGM ) return null;
  const open = foundry.applications.instances.get(WINDOW_ID);
  if ( open ) {
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new (WaitsApp())();
  app.render({ force: true });
  return app;
}

/**
 * The queue changed: the open panel redraws (and closes when it is empty); otherwise it opens when the game is held up —
 * a blocked action right away, a player awaited beyond the windows' delay (windows without delay only). Requests made
 * to the GM themselves do not open the panel: their window is already in front of them.
 */
function onQueueChanged(q) {
  if ( !game.user.isGM ) return;
  const app = foundry.applications.instances.get(WINDOW_ID);
  clearTimeout(opener);
  const held = [...q.players, ...q.blocked];
  for ( const id of [...dismissed] ) if ( !held.some(l => l.id === id) ) dismissed.delete(id);
  if ( app ) return q.count ? app.render() : app.close();
  if ( !windowsUnlimited() ) return;   // with a delay, nothing holds up the game: the window resolves, an absentee's roll is made
  if ( q.blocked.some(l => !dismissed.has(l.id)) ) return void openPlayerWaits();
  // §422: a requested roll already has its tracking window on screen — it does not open the panel.
  const pending = q.players.filter(l => !dismissed.has(l.id) && !l.groupRoll);
  if ( !pending.length ) return;
  const due = pending[0].since + (combatWindowSeconds() * 1000) - Date.now();
  opener = setTimeout(() => {
    if ( queue().players.some(l => !dismissed.has(l.id) && !l.groupRoll) ) openPlayerWaits();
  }, Math.max(0, due));
}

const TOOL = "das-gm-queue";

/**
 * §427: the badge on the "GM Queue" button (token toolbar) — how many rows are waiting. Placed on the button itself:
 * nothing is redrawn.
 */
function showCount(q=null) {
  if ( !game.user?.isGM ) return;
  const button = document.querySelector(`#scene-controls [data-tool="${TOOL}"]`);
  if ( !button ) return;
  // Never a count of its own: the queue announced (or refreshed now, which announces it if it changed).
  const count = (q ?? refreshQueue()).count;
  button.classList.toggle("das-queue-waiting", count > 0);
  if ( count > 0 ) button.dataset.count = String(count);
  else delete button.dataset.count;
}

export function registerPlayerWaitsUI() {
  route(GM_QUEUE_HOOK, q => { onQueueChanged(q); showCount(q); }, { always: true, label: "GM queue: panel not refreshed" });
  // §427: a button to open the Queue by hand (it only opens by itself when the game is held up), next to "Start a combat".
  route("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    tokens.tools[TOOL] = {
      name: TOOL, order: last + 1, icon: "fa-solid fa-list-check", title: "DND5ECOMBAT.Attente.Titre",
      button: true, visible: true,
      onChange: () => { openPlayerWaits(); }
    };
  }, { always: true, label: "GM queue: tool" });
  route("renderSceneControls", () => showCount(), { always: true, label: "GM queue: count on the tool" });
}
