/**
 * §381 (issue #35): the hourglass above the token of the creature being waited for — a Reaction, a choice, a roll open for a
 * player or for the GM —, seen by the whole table except whoever answers. It flips while the window is open, no name or delay.
 * It only says that the table is waiting for this token, never what the window asks. (Tests of
 * 2026-11-06: a pink delay ring, then three waving dots; the user kept the plain hourglass.)
 *
 * A GM window for a creature with no player: according to `awaitingGm`, a "The GM decides…" banner that does not
 * designate any creature (default), the hourglass on the token, or nothing — the GM always sees the hourglass.
 *
 * Each client draws by itself, in `canvas.interface`, at the token's displayed position, and only if it sees the token
 * (`Token#isVisible`). Nothing is written to a document. State: adapter/awaiting.mjs; display rules: core/awaiting.mjs.
 */

import { awaitingAlive, awaitingPlacement } from "../core/awaiting.mjs";
import { AWAITING_HOOK, awaitingList } from "../adapter/awaiting.mjs";
import { AWAITING_SETTINGS_HOOK, awaitingViewer } from "../runtime/awaiting.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";

/** Le sablier de Font Awesome 6 (`hourglass-half`). */
const HOURGLASS = "";
const BANNER_ID = "das-awaiting-banner";
/** Size, as a fraction of a cell; duration of a cycle (the hourglass flips, then runs out). */
const SIZE = 0.3;
const CYCLE_MS = 2400;
const FLIP_MS = 450;

/** The hourglasses drawn on this client: wait id → view. */
const views = new Map();
let layer = null;
let ticking = false;
let entries = [];

function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
    // `canvas.interface` sorts its children: the tokens layer is at 200 there (seen in play, V14) — above the controls, so the
    // hourglass and the name do not pass under a token's image.
    layer.zIndex = 1050;
  }
  return layer;
}

/** The drawing of an hourglass: dark disc with a white rim, hourglass — nothing else, no name or delay ring (the user, 2026-11-06:
 * it only says that the table is waiting for this token). */
function build() {
  const size = canvas.grid.size;
  const r = Math.max(10, SIZE * size / 2);
  const root = new PIXI.Container();
  const back = new PIXI.Graphics().beginFill(0x000000, 0.6).drawCircle(0, 0, r).endFill()
    .lineStyle(2, 0xffffff, 0.9).drawCircle(0, 0, r);
  const glass = new PIXI.Text(HOURGLASS, {
    fontFamily: ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"], fontWeight: "900", fontSize: Math.round(r * 1.1),
    fill: 0xffffff, stroke: 0x000000, strokeThickness: 2
  });
  glass.anchor.set(0.5);
  root.addChild(back, glass);
  return { root, glass, r, born: Date.now() };
}

/** The flip: a half turn at the start of each cycle, then the hourglass runs out standing still. */
function flipAngle(view, now) {
  const t = (now - view.born) % CYCLE_MS;
  const turns = Math.floor((now - view.born) / CYCLE_MS);
  const p = Math.min(1, t / FLIP_MS);
  const eased = p < 0.5 ? 2 * p * p : 1 - (Math.pow(-2 * p + 2, 2) / 2);
  return (turns + eased) * Math.PI;
}

function drop(id) {
  const view = views.get(id);
  if ( !view ) return;
  views.delete(id);
  view.root.destroy({ children: true });
}

function tick() {
  const now = Date.now();
  const viewer = awaitingViewer();
  const shown = new Set();
  for ( const entry of entries ) {
    if ( !awaitingAlive(entry, now) || (awaitingPlacement(entry, viewer) !== "token") ) continue;
    const doc = fromUuidSync(entry.token ?? "", { strict: false });
    const token = doc?.object;
    if ( !token || token.destroyed || (doc.parent !== canvas.scene) ) continue;
    shown.add(entry.id);
    let view = views.get(entry.id);
    if ( !view ) views.set(entry.id, view = build());
    if ( view.root.parent !== layerOf() ) layerOf().addChild(view.root);
    view.root.visible = token.isVisible === true;
    // Top right corner of the token: the place of timers (above) and of scrolling texts (center) stays free.
    view.root.position.set(token.x + token.w - (view.r * 0.6), token.y + (view.r * 0.6));
    view.glass.rotation = flipAngle(view, now);
  }
  for ( const id of [...views.keys()] ) if ( !shown.has(id) ) drop(id);
  updateBanner(now, viewer);
  if ( !views.size && !entries.length ) stopTicking();
}

/** The discreet "The GM decides…" banner: a GM window for a creature that is not designated. */
function updateBanner(now, viewer) {
  const wanted = entries.some(e => awaitingAlive(e, now) && (awaitingPlacement(e, viewer) === "banner"));
  let banner = document.getElementById(BANNER_ID);
  if ( !wanted ) { banner?.remove(); return; }
  if ( banner ) return;
  banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.className = "das-awaiting-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `<i class="fa-solid fa-hourglass-half" inert></i><span></span>`;
  banner.querySelector("span").textContent = loc("Attente.MJDecide");
  document.body.append(banner);
}

function startTicking() {
  if ( ticking || !canvas?.app?.ticker ) return;
  canvas.app.ticker.add(tick);
  ticking = true;
}
function stopTicking() {
  if ( !ticking ) return;
  canvas.app?.ticker?.remove(tick);
  ticking = false;
}

function onAwaiting(list) {
  entries = Array.isArray(list) ? list : [];
  // The banner is HTML: placed here too, without waiting for the canvas ticker (stopped in a background tab, seen in play).
  updateBanner(Date.now(), awaitingViewer());
  if ( entries.length ) startTicking();
  else { for ( const id of [...views.keys()] ) drop(id); document.getElementById(BANNER_ID)?.remove(); }
}

function clear() {
  for ( const id of [...views.keys()] ) drop(id);
  stopTicking();
  layer = null;
}

export function registerAwaitingUI() {
  route(AWAITING_HOOK, onAwaiting, { always: true, label: "awaiting: hourglass not drawn" });
  route("canvasReady", () => onAwaiting(awaitingList()), { always: true, label: "awaiting: hourglass not redrawn with the canvas" });
  route("canvasTearDown", clear, { always: true, label: "awaiting: hourglass not cleared with the canvas" });
  // A display setting changes (world or client): redraw (GM mode, hidden for oneself).
  route(AWAITING_SETTINGS_HOOK, () => {
    clear();
    onAwaiting(awaitingList());
  }, { always: true, label: "awaiting: hourglass not refreshed after a setting change" });
}

/** `api.ui.awaiting()`: the waits in progress known to this client (public form), and what this client shows of them. */
export function awaitingState() {
  const viewer = awaitingViewer();
  return awaitingList().map(e => ({ ...e, shown: awaitingPlacement(e, viewer) }));
}
