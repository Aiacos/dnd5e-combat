/**
 * Visual feedback above tokens, BG3 style (SPEC §15.3): "Critical!", "Miss", Cover, the
 * Reaction, the saving throw — in the manner of the core's scrolling text (`canvas.interface.createScrollingText`,
 * client/canvas/groups/interface.mjs:174), the one dnd5e uses for HP
 * (documents/actor/actor.mjs:3557). The HP themselves stay with the system.
 *
 * Passive consumer: the `dnd5e-combat.resolution` hook is published only on the active GM, who
 * runs the engine; here each client reads the resolution on the message's flag, which it receives
 * like everyone, and writes only what changed since the previous state (core/feedback.mjs).
 * Nothing is decided, nothing is written to the world.
 *
 * §228: the engine draws its texts itself (a container in `canvas.interface`, animated by the core's `CanvasAnimation`) instead of
 * the core's scrolling text, which erases its text throughout its run and accepts no image: pace, run, size, what
 * is displayed and pictograms (die and roll total) are set by the GM for the table ("Floating texts" tab). The core setting
 * "scrolling text" (`core.scrollingStatusText`) is still respected. HP lost or restored stay dnd5e's
 * (documents/actor/actor.mjs:3557, `_displayTokenEffect`): their pace cannot be set without patching the system.
 */

import { MODULE_ID } from "../constants.mjs";
import { feedbackBetween } from "../core/feedback.mjs";
import { FLOAT_CATEGORY_DEFAULTS, FLOAT_DEFAULTS, FLOAT_ICONS, floatLine, floatLabel, floatFrame, floatDelays, checkKind, floatStyleOf, floatOffset,
  floatEntrance, hpFloat, floatOutcome, floatRolled, spinPhase, damageParts, damageKind, saveKind, strikeProgress, floatEndName } from "../core/float-text.mjs";
import { route } from "../runtime/router.mjs";
import { loc, NOTICE_QUERY, receiveNotice, waitForDice, isExecutor } from "../runtime/shared.mjs";
import { resourceChangesOf } from "../adapter/limits.mjs";
import { keyLabel } from "../adapter/group-roll.mjs";
import { d20Mode } from "../adapter/messages.mjs";

/** Last state seen, per message. */
const seen = new Map();
/** A message we have never seen go by: its facts are shown only if it is recent (not an old message replayed). */
const FRESH_MS = 120000;
/** Per token, the time (ms) when its next text may start (core/float-text.mjs, `floatDelays`). */
const busyUntil = new Map();
/** The texts' container, recreated with the canvas. */
let layer = null;

/**
 * §400: the look of each kind comes from the world's theme (setting `floatTheme`, imported as JSON from the workshop;
 * core/float-text.mjs, `floatStyleOf`). Without a theme, the previous one: orange prompt (Bounce!), red refusal (Too far), blue
 * effect end, green resource returned, orange spent, red extra damage (§223), golden Heroic Inspiration (§282), amber success
 * at a cost (issue #32), checks (§292).
 */
const THEME_SETTING = "floatTheme";
/** §400: the world setting that puts the engine's texts in place of the system's; and the trace of having turned off the core's. */
export const FLOAT_SYSTEM = "floatSystem";
const CORE_MUTED = "floatCoreMuted";
let themeCache = null;
/** Per token, the side of the last arc text: they alternate left / right. */
const lastSide = new Map();

function theme() {
  if ( themeCache ) return themeCache;
  try { themeCache = game.settings.get(MODULE_ID, THEME_SETTING) ?? {}; } catch { themeCache = {}; }
  return themeCache;
}

/** Are the engine's floating texts the table's (world setting)? */
export function floatsActive() {
  try { return !!game.settings.get(MODULE_ID, FLOAT_SYSTEM); } catch { return true; }
}

/** Une couleur `#rrggbb` en nombre PIXI. */
// Black is 0: only an unreadable text falls back to white.
const hexNumber = c => { const n = Number.parseInt(String(c ?? "#ffffff").slice(1), 16); return Number.isFinite(n) ? n : 0xffffff; };

function textOf(f) {
  if ( f.kind?.startsWith?.("dmg-") ) return f.text;   // §400, batch 3: damage by type
  switch ( f.kind ) {
    case "critical": return loc("Retour.Critique");
    case "miss": return loc("Retour.Rate");
    case "hit": return null;   // §228: "Hit" or the roll alone (core/float-text.mjs, `floatLine`)
    case "cover": return (f.degree === "total") ? loc("Retour.AbriTotal") : loc(`Abri.${f.degree}`);
    case "reaction": return f.name;
    case "saveSuccess": return f.text ?? loc("Retour.SauvegardeReussie");   // §400: a sheet save carries its label
    case "saveFail": return f.text ?? loc(f.auto ? "Retour.SauvegardeRateeOffice" : "Retour.SauvegardeRatee");
    case "duplicate": return loc("Retour.Replique");
    case "unaffected": return loc("Retour.NonAffecte");
    case "prompt": case "refused": case "forced": case "ended": case "gain": case "spend": case "strike": case "heroic": case "atCost":
    case "check": case "checkSuccess": case "checkFail": case "save": case "initiative":
    case "damage": case "healing": case "temp": case "effectOn": case "effectOff": return f.text;
  }
  return null;
}

/** A module setting, or its default value if it is not (yet) registered. */
function option(key, fallback) {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; }
  catch { return fallback; }
}

/** The table's settings (§228), read at each volley: a GM change applies immediately. */
function floatOptions() {
  const show = Object.fromEntries(Object.entries(FLOAT_CATEGORY_DEFAULTS).map(([key, value]) => [key, !!option(key, value)]));
  return {
    show, dice: !!option("floatDice", true), icons: !!option("floatIcons", true), hitText: loc("Retour.Touche"),
    modeText: { advantage: loc("Retour.Avantage"), disadvantage: loc("Retour.Desavantage") }, modeJoiner: loc("Retour.AvecMode"),
    duration: Number(option("floatDuration", FLOAT_DEFAULTS.duration)) || FLOAT_DEFAULTS.duration,
    spacing: Number(option("floatSpacing", FLOAT_DEFAULTS.spacing)),
    distance: Number(option("floatDistance", FLOAT_DEFAULTS.distance)) || FLOAT_DEFAULTS.distance,
    scale: (Number(option("floatScale", FLOAT_DEFAULTS.scale)) || FLOAT_DEFAULTS.scale) / 100,
    up: option("floatDirection", FLOAT_DEFAULTS.direction) === "up"
  };
}

/**
 * The texts' container, in the interface group (above the primary group, where tokens are drawn) and, §400, above
 * all its layers: tokens (200), controls (1000) and the core's scrolling text (1100, config.mjs `zIndexScrollingText`) — a text is
 * never hidden by a token.
 */
function layerOf() {
  if ( !layer || layer.destroyed || (layer.parent !== canvas.interface) ) {
    layer = canvas.interface.addChild(new PIXI.Container());
    layer.eventMode = "none";
    layer.interactiveChildren = false;
    layer.zIndex = 1200;
  }
  return layer;
}

/** A core image (white), at the text's height and tinted with its color. */
async function iconSprite(src, size, tint) {
  const texture = await foundry.canvas.loadTexture(src).catch(() => null);
  if ( !texture ) return null;
  const sprite = new PIXI.Sprite(texture);
  sprite.width = sprite.height = size;
  sprite.tint = tint;
  return sprite;
}

/** §400: a pictogram's frame (hexagon point up, or circle), filled and bordered in the theme's colors. */
function badgeShape(kind, size, fill, border, weight=1) {
  const g = new PIXI.Graphics();
  g.lineStyle(Math.max(1.2, size * 0.04) * weight, border, 1).beginFill(fill, 1);
  const r = size / 2;
  if ( kind === "circle" ) g.drawCircle(r, r, r * 0.92);
  else g.drawPolygon(Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3 * i) - (Math.PI / 2);
    return [r + (Math.cos(a) * r * 0.95), r + (Math.sin(a) * r * 0.95)];
  }).flat());
  return g.endFill();
}

/**
 * §400: the workshop's d20, in fine strokes (user's request: simpler than the core's icon) — the ten-sided outline seen from the
 * front, the front face's triangle and its edges, drawn at `size` px (original drawing on 24 px).
 */
function d20Shape(size, color) {
  const k = size / 24;
  const p = (x, y) => [x * k, y * k];
  const g = new PIXI.Graphics();
  g.lineStyle(Math.max(1, 1.5 * k), color, 1).drawPolygon([...p(12, 1.5), ...p(21.5, 7), ...p(21.5, 17), ...p(12, 22.5), ...p(2.5, 17), ...p(2.5, 7)]);
  g.lineStyle(Math.max(1, 1.3 * k), color, 1).drawPolygon([...p(12, 5.5), ...p(17.8, 15), ...p(6.2, 15)]);
  g.lineStyle(Math.max(0.8, 1.05 * k), color, 1);
  for ( const [[x1, y1], [x2, y2]] of [[[12, 1.5], [12, 5.5]], [[2.5, 7], [6.2, 15]], [[21.5, 7], [17.8, 15]], [[6.2, 15], [12, 22.5]], [[12, 22.5], [17.8, 15]]] ) {
    g.moveTo(...p(x1, y1)).lineTo(...p(x2, y2));
  }
  return g;
}

/** §400: the theme's pictogram (a workshop name or a path), possibly in its frame; the d20 is the workshop's. */
async function themedIcon(style, fontSize) {
  const src = FLOAT_ICONS[style.icon] ?? ((style.icon in FLOAT_ICONS) ? null : style.icon);
  if ( !src ) return null;
  const d20 = style.icon === "d20";
  if ( style.badge === "none" ) return d20 ? d20Shape(fontSize * 1.15, hexNumber(style.color)) : iconSprite(src, fontSize * 1.15, hexNumber(style.color));
  const size = fontSize * 1.7;
  const box = new PIXI.Container();
  box.addChild(badgeShape(style.badge, size, hexNumber(style.badgeColor), hexNumber(style.badgeBorder)));
  const sprite = d20 ? d20Shape(size * 0.56, hexNumber(style.badgeBorder)) : await iconSprite(src, size * 0.56, hexNumber(style.badgeBorder));
  if ( sprite ) { sprite.position.set(size * 0.22, size * 0.22); box.addChild(sprite); }
  return box;
}

/**
 * §400: a sound for the hexagon (module/sounds: generated with ElevenLabs, chosen by the user), on this client's Interface
 * channel — each hears the texts they see, nothing is broadcast. This workstation's settings: `floatSounds`,
 * `floatSoundVolume`. Returns the sound's promise.
 */
function floatSound(name, { loop=false }={}) {
  let volume = 0;
  try {
    if ( !game.settings.get(MODULE_ID, "floatSounds") ) return null;
    volume = (Number(game.settings.get(MODULE_ID, "floatSoundVolume")) || 0) / 100;
  } catch { return null; }
  if ( volume <= 0 ) return null;
  const played = foundry.audio.AudioHelper.play({ src: `modules/${MODULE_ID}/sounds/float-${name}.ogg`, volume, loop, channel: "interface" }, false);
  return Promise.resolve(played).catch(() => null);
}

/**
 * §400: one sound at a time (user's request: a whole table's initiative turned into a cacophony) — a single clatter,
 * shared by the spinning hexagons (it starts with the first, stops with the last), and a single outcome sound per volley: another
 * arriving less than `RESULT_GAP` ms after the previous one stays silent.
 */
const spinning = new Set();
let rattle = null;
let lastResult = -Infinity;
const RESULT_GAP = 400;
function rattleOn(id) {
  spinning.add(id);
  rattle ??= floatSound("spin", { loop: true }) ?? Promise.resolve(null);
}
function rattleOff(id) {
  if ( !spinning.delete(id) || spinning.size || !rattle ) return;
  const sound = rattle;
  rattle = null;
  sound.then(s => s?.stop?.({ fade: 60 })).catch(() => {});
}
function resultSound(name) {
  const now = performance.now();
  if ( (now - lastResult) < RESULT_GAP ) return;
  lastResult = now;
  floatSound(name);
}

/**
 * §400, batch 2: the roll hexagon (BG3 style) — theme background and border, the die pictogram at the center.
 * `step(phase)` (core/float-text.mjs, `spinPhase`): during the throw, the hexagon and die spin; at the reveal, the die gives
 * way to the total, the border takes the outcome's color (`okColor` / `failColor`, kept for a neutral roll) and thickens,
 * and the whole thing pulses once.
 * @returns {Promise<{box: PIXI.Container, step: Function}>}
 */
async function spinner(look, fontSize, roll, kind) {
  const size = fontSize * 1.9;
  const box = new PIXI.Container();
  const inner = box.addChild(new PIXI.Container());
  inner.pivot.set(size / 2, size / 2);
  inner.position.set(size / 2, size / 2);
  const hex = inner.addChild(badgeShape("hex", size, hexNumber(look.badgeColor), hexNumber(look.badgeBorder)));
  const die = inner.addChild(d20Shape(size * 0.55, hexNumber(look.badgeBorder)));
  die.position.set(size * 0.225, size * 0.225);
  const { PreciseText } = foundry.canvas.containers;
  const number = new PreciseText(String(roll), PreciseText.getTextStyle({ fill: 0xffffff, fontSize: Math.round(fontSize * 0.9),
    fontFamily: look.font, fontWeight: "700", stroke: 0x000000, strokeThickness: 3 }));
  number.anchor.set(0.5);
  number.position.set(size / 2, size / 2);
  number.visible = false;
  box.addChild(number);
  const outcome = floatOutcome(kind);
  const border = hexNumber((outcome === "ok") ? look.okColor : (outcome === "fail") ? look.failColor : look.badgeBorder);
  let revealed = false;
  // §400: the die clatter shared while the hexagon spins, then the outcome sound (chime, thud, neutral click).
  const id = Symbol("spinner");
  const quiet = () => rattleOff(id);
  const step = phase => {
    if ( phase.spinning ) {
      rattleOn(id);
      inner.rotation = phase.angle;
      return;
    }
    if ( !revealed ) {
      revealed = true;
      quiet();
      resultSound((outcome === "ok") ? "success" : (outcome === "fail") ? "fail" : "neutral");
      inner.rotation = 0;
      if ( die ) die.visible = false;
      number.visible = true;
      hex.clear();
      inner.removeChild(hex);
      inner.addChildAt(badgeShape("hex", size, hexNumber(look.badgeColor), border, 1.5), 0);
    }
    inner.scale.set(phase.pulse);
    number.scale.set(phase.pulse);
  };
  return { box, step, dispose: quiet };
}

/**
 * A line (pictograms, roll total, text) near the token, then its animation, in the look of its kind in the theme (§400): font,
 * outline, halo, framed pictogram, appearance, and path — scrolls (down from the feet, or up from the head), stays
 * above the head, or goes off in an arc to the side (a token's arcs alternate left / right).
 */
async function drawLine(token, line, kind, options, { factor=1, roll=null, waitFor=null }={}) {
  const look = floatStyleOf(theme(), kind);
  // §400: a text that follows a roll waits for the 3D dice to finish (`waitFor`) — except the hexagon, which spins while they roll.
  const spinning = look.spin && floatRolled(kind) && Number.isFinite(roll);
  if ( waitFor && !spinning ) await waitFor.catch(() => {});
  const fontSize = Math.round(look.size * options.scale * factor);
  const fill = hexNumber(look.color);
  const { PreciseText } = foundry.canvas.containers;
  const textStyle = { fill, fontSize, fontFamily: look.font, fontWeight: String(look.weight), fontStyle: look.italic ? "italic" : "normal",
    letterSpacing: look.tracking * fontSize, stroke: hexNumber(look.stroke), strokeThickness: look.strokeW };
  // A halo: the text's drop shadow, no offset, blurred. Without a halo, the core's light shadow (config.mjs `canvasTextStyle`).
  if ( look.glow > 0 ) Object.assign(textStyle, { dropShadow: true, dropShadowBlur: look.glow, dropShadowColor: hexNumber(look.glowColor),
    dropShadowDistance: 0, dropShadowAlpha: 1, padding: Math.ceil(look.glow * 1.5) });
  const style = PreciseText.getTextStyle(textStyle);
  const parts = [];
  // §400, batch 2: a roll whose kind has the spinning hexagon — the die spins, then the total is written at the center and
  // the border takes the outcome's color; the text comes afterwards. The total is shown there even without "Dice result":
  // that is the point of the hexagon.
  const spin = (look.spin && floatRolled(kind) && Number.isFinite(roll)) ? await spinner(look, fontSize, roll, kind) : null;
  if ( spin ) parts.push(spin.box);
  else {
    const icon = options.icons ? await themedIcon(look, fontSize) : null;
    if ( line.dieIcon && (look.icon !== "d20") ) {
      parts.push(d20Shape(fontSize * 1.15, fill));
    }
    if ( icon ) parts.push(icon);
  }
  let label = floatLabel(spin ? { ...line, roll: null } : line, options.modeText, options.modeJoiner);
  if ( look.upper ) label = label.toLocaleUpperCase(game.i18n.lang);
  const text = label ? new PreciseText(label, style) : null;
  if ( text ) parts.push(text);
  if ( !parts.length || !canvas?.ready || !token.visible ) return;
  // Side by side, vertically centered.
  const box = new PIXI.Container();
  box.name = kind;   // the kind, readable by test tools
  const gap = fontSize * 0.25;
  const height = Math.max(...parts.map(p => p.height));
  let x = 0;
  for ( const part of parts ) {
    part.position.set(x, (height - part.height) / 2);
    part.baseX = x;
    x += part.width + gap;
    box.addChild(part);
  }
  const width = x - gap;
  const { x: cx, y: cy } = token.center;
  const grid = canvas.grid.size;
  const motion = look.motion;
  // The starting point: scrolls down from the feet (dnd5e wrote HP from the center going up, actor.mjs:3557), up
  // from the head; stays above the head; the arc starts from the top of the token.
  const up = (motion === "anchor") || ((motion === "float") && options.up);
  const start = (motion === "anchor") ? cy - (token.h / 2) - (grid * 0.05)
    : (motion === "arc") ? cy - (token.h * 0.25)
    : up ? cy - (token.h / 2) : cy + (token.h / 2);
  box.pivot.set(width / 2, (motion === "arc") ? height / 2 : up ? height : 0);
  const path = { travel: (up ? -1 : 1) * options.distance * grid };
  if ( motion === "arc" ) {
    const id = token.document?.id ?? token.id;
    const side = -(lastSide.get(id) ?? 1);
    lastSide.set(id, side);
    Object.assign(path, { side, spread: look.spread * grid * (0.7 + (Math.random() * 0.6)), rise: grid * (0.5 + (Math.random() * 0.3)), drop: grid * 0.35 });
  }
  const s = canvas.dimensions.uiScale ?? 1;
  const x0 = cx + ((motion === "float") ? (Math.random() - 0.5) * 0.1 * width : 0);
  box.position.set(x0, start);
  box.alpha = 0;
  layerOf().addChild(box);
  if ( spin && waitFor ) {
    await spinWithDice(box, { spin, text, waitFor, look, options, motion, path, x0, start, scale: s, fontSize });
    return;
  }
  // §400: a lost condition, struck through from left to right once the text has appeared — the bar in the text's color,
  // on a dark stroke.
  const strike = (look.strike && text) ? box.addChild(new PIXI.Graphics()) : null;
  const drawStrike = k => {
    const pad = Number(text.style?.padding) || 0;
    const x1 = text.x + pad;
    const w = Math.max(0, text.width - (2 * pad)) * k;
    const y = text.y + (text.height * 0.56);
    const thick = Math.max(2, fontSize * 0.09);
    strike.clear();
    if ( w <= 0 ) return;
    strike.lineStyle(thick + Math.max(2, look.strokeW), (look.strokeW > 0) ? hexNumber(look.stroke) : 0x000000, 0.7).moveTo(x1, y).lineTo(x1 + w, y);
    strike.lineStyle(thick, fill, 1).moveTo(x1, y).lineTo(x1 + w, y);
  };
  const state = { p: 0 };
  // The hexagon spins then reveals itself: the text stays readable at least 2.2 s afterwards.
  const duration = spin ? Math.max(options.duration * 1000, look.spinMs + 2200) : options.duration * 1000;
  if ( spin && text ) text.alpha = 0;
  try {
    await foundry.canvas.animation.CanvasAnimation.animate([{ parent: state, attribute: "p", from: 0, to: 1 }], {
      context: box, duration,
      ontick: () => {
        if ( box.destroyed ) return;
        if ( spin ) {
          const phase = spinPhase(state.p * duration, look.spinMs);
          spin.step(phase);
          if ( text ) { text.alpha = phase.text; text.x = text.baseX - ((1 - phase.text) * fontSize * 0.4); }
        }
        if ( strike ) drawStrike(strikeProgress(state.p * duration));
        const f = floatFrame(state.p);
        const e = floatEntrance(state.p, look.entrance);
        const o = floatOffset(state.p, motion, path);
        box.alpha = f.alpha;
        box.scale.set(e.scale * s);
        box.position.set(x0 + o.dx + e.dx, start + o.dy);
      }
    });
  } finally {
    spin?.dispose?.();
    // Pictogram textures are those of the core's cache: we do not destroy them.
    if ( !box.destroyed ) box.destroy({ children: true, texture: false });
  }
}

/**
 * §400: the hexagon of a roll timed to Dice So Nice — it appears at the throw and spins as long as the 3D dice roll
 * (`waitFor`, bounded by `waitForDice`), `spinMs` at least; then it reveals itself and the text stays readable for the set
 * time (2.2 s at least), and fades over its last third. Animated by the canvas ticker, the total duration not being
 * known in advance.
 */
function spinWithDice(box, { spin, text, waitFor, look, options, motion, path, x0, start, scale, fontSize }) {
  const ease = x => 0.5 - (Math.cos(Math.PI * x) / 2);
  const ticker = canvas.app.ticker;
  const t0 = performance.now();
  let revealAt = null;
  waitFor.catch(() => {}).then(() => { revealAt = Math.max(performance.now(), t0 + look.spinMs); });
  const hold = Math.max((options.duration * 1000) - look.spinMs, 2200);
  if ( text ) text.alpha = 0;
  return new Promise(resolve => {
    const done = () => {
      ticker.remove(tick);
      spin.dispose?.();
      if ( !box.destroyed ) box.destroy({ children: true, texture: false });
      resolve();
    };
    const tick = () => {
      if ( box.destroyed || !canvas?.ready ) return done();
      const now = performance.now();
      const elapsed = now - t0;
      const phase = spinPhase(elapsed, (revealAt ?? Infinity) - t0);
      spin.step(phase);
      if ( text ) { text.alpha = phase.text; text.x = text.baseX - ((1 - phase.text) * fontSize * 0.4); }
      const q = revealAt ? Math.min(1, Math.max(0, now - revealAt) / hold) : 0;
      const fadeOut = (q > 0.67) ? 1 - ease((q - 0.67) / 0.33) : 1;
      const o = floatOffset(q, motion, path);
      box.alpha = Math.min(1, elapsed / 250) * fadeOut;
      box.scale.set(scale);
      box.position.set(x0 + o.dx, start + o.dy);
      if ( q >= 1 ) done();
    };
    ticker.add(tick);
  });
}

/**
 * §400: the end of a roll message's 3D dice. Dice So Nice only marks the message as animated (`_dice3danimating`) after its own
 * handling, just after creation: asked too early, the wait returned immediately, one time in two (seen in play).
 */
function diceDone(message) {
  return new Promise(resolve => setTimeout(resolve, 120)).then(() => waitForDice(message));
}

/**
 * §400: an effect end announced twice — the engine's notice "End: Sleep" (`ended`) and the removal of the struck-out "Sleep" effect
 * (`effectOff`) — is shown only once: on the same token, within `END_WINDOW` ms, the second, whose text contains the name of
 * the first (or the reverse), is dropped.
 */
const recentEnds = [];
const END_WINDOW = 2000;
function duplicateEnd(f) {
  if ( !["ended", "effectOff"].includes(f.kind) || !f.text ) return false;
  const now = Date.now();
  while ( recentEnds.length && ((now - recentEnds[0].at) > END_WINDOW) ) recentEnds.shift();
  const plain = floatEndName(f.text);
  // Two announcements of the same end (the engine's notice and the effect's removal), whatever their kind.
  const twin = recentEnds.find(e => (e.token === f.token) && (e.plain.includes(plain) || plain.includes(e.plain)));
  recentEnds.push({ token: f.token, kind: f.kind, plain, at: now });
  return !!twin;
}

function show(feedback, { burst=false }={}) {
  // §400: the engine's texts depend on its world switch (which turns off the core's), no longer on the core setting.
  if ( !canvas?.ready || !floatsActive() ) return;
  feedback = feedback.filter(f => !duplicateEnd(f));
  const options = floatOptions();
  // §400, batch 3: the damage of a single blow goes out almost together (a third of the set gap).
  if ( burst ) options.spacing *= 0.3;
  const lines = [];
  for ( const f of feedback ) {
    const token = fromUuidSync(f.token)?.object;
    if ( !token?.visible || token.document.isSecret ) continue;
    if ( floatStyleOf(theme(), f.kind).show === false ) continue;
    const raw = textOf(f);
    // "partial Cover" comes from a key shared with the chat
    const line = floatLine(f, raw ? raw.charAt(0).toLocaleUpperCase() + raw.slice(1) : null, options);
    if ( line ) lines.push({ f, token, line });
  }
  const delays = floatDelays(lines.map(l => l.f.token), options.spacing, Date.now(), busyUntil);
  lines.forEach(({ f, token, line }, i) => setTimeout(() => {
    if ( !canvas?.ready || !token.visible ) return;
    // §41.3: if the view changes during the scroll (a staircase: another level, the canvas is redrawn), the text goes with the
    // canvas. Nothing to catch up.
    drawLine(token, line, f.kind, options, { factor: f.factor ?? 1, roll: Number.isFinite(f.roll) ? f.roll : null, waitFor: f.waitFor ?? null }).catch(() => {});
  }, delays[i]));
}

/**
 * §282: the flash of a used Heroic Inspiration, on the token, on each client (the notice travels through
 * `notice(…, { all: true })`) — a golden sun that grows and spins, two rings that widen, ~1.4 s. Drawn even without
 * floating texts: it is the action's visual feedback.
 */
export async function heroicBurst(token, { color=0xffd24a, icon="icons/svg/sun.svg" }={}) {
  const placeable = (typeof token === "string") ? fromUuidSync(token)?.object : (token?.object ?? token);
  if ( !canvas?.ready || !placeable?.visible || placeable.document?.isSecret ) return;
  const gold = color;
  const size = Math.max(placeable.w, placeable.h);
  const box = new PIXI.Container();
  box.position.set(placeable.center.x, placeable.center.y);
  const rings = [0, 1].map(() => box.addChild(new PIXI.Graphics()));
  const texture = await foundry.canvas.loadTexture(icon).catch(() => null);
  const sun = texture ? box.addChild(new PIXI.Sprite(texture)) : null;
  if ( sun ) { sun.anchor.set(0.5); sun.tint = gold; }
  layerOf().addChild(box);
  const state = { p: 0 };
  try {
    await foundry.canvas.animation.CanvasAnimation.animate([{ parent: state, attribute: "p", from: 0, to: 1 }], {
      context: box, duration: 1400,
      ontick: () => {
        if ( box.destroyed ) return;
        const p = state.p;
        rings.forEach((g, i) => {
          const q = Math.min(1, Math.max(0, (p - (i * 0.2)) / 0.8));
          g.clear().lineStyle(Math.max(2, size * 0.04 * (1 - q)), gold, 0.9 * (1 - q)).drawCircle(0, 0, size * (0.45 + (0.55 * q)));
        });
        if ( sun ) {
          sun.alpha = (p < 0.25) ? p / 0.25 : Math.max(0, 1 - ((p - 0.25) / 0.75));
          sun.rotation = p * Math.PI;
          sun.width = sun.height = size * (0.6 + (0.5 * p));
        }
      }
    });
  } finally {
    if ( !box.destroyed ) box.destroy({ children: true, texture: false });
  }
}

/**
 * A notice above a token, on this client: prompt ("Bounce!"), refusal ("Already targeted"), effect end. Prompts and
 * refusals are those of the one who acts — only they see them, like the aiming they accompany.
 */
export function floatNotice(token, text, kind="prompt") {
  if ( !text || !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  show([{ token: token?.uuid ?? token, kind, text }]);
}

/** The text of a resource change (`resourceChangesOf`): "+1 level 2 slot", "−1 Wild Shape". */
function resourceText(c) {
  const sign = c.kind === "gain" ? "+" : "−";
  return c.type === "spellSlots" ? loc("Retour.Emplacement", { sign, n: c.n, level: c.level }) : loc("Retour.Utilisation", { sign, n: c.n, item: c.name ?? "" });
}

/**
 * On a message's creation, on everyone: §16.40, what a use returned or spent (Wild Resurgence), above the
 * user's token; and an effect that ends on damage (runtime/triggers.mjs, `ended` message), above its bearer.
 */
function onCreateMessage(message) {
  if ( (message.type === "usage") && game.settings.get(MODULE_ID, "feedbackText") && canvas?.ready
    && ((Date.now() - (message.timestamp ?? 0)) <= FRESH_MS) ) {
    const changes = resourceChangesOf(message);
    const actor = changes.length ? message.getAssociatedActor?.() : null;
    const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
    if ( token ) show(changes.map(c => ({ token: token.uuid, kind: c.kind, text: resourceText(c) })));
  }
  if ( message.type === "damage" ) showStrikes(message);
  if ( message.type === "check" ) showCheck(message).catch(() => {});
  if ( message.type === "save" ) showSave(message).catch(() => {});
  const ended = message.getFlag?.(MODULE_ID, "ended");
  if ( !ended?.actor || !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  if ( (Date.now() - (message.timestamp ?? 0)) > FRESH_MS ) return;
  const actor = fromUuidSync(ended.actor, { strict: false });
  const token = actor?.getActiveTokens?.(false, true)?.[0];
  if ( token ) show([{ token: token.uuid, kind: "effectOff", text: fromUuidSync(ended.effect, { strict: false })?.name ?? ended.item ?? "" }]);
}

/**
 * §223: on everyone, at the damage roll of a blow that carries Sneak Attack (runtime/sneak.mjs, `sneak` flag) or
 * bonus damage chosen by the author (runtime/triggers.mjs, `bonuses` flag, `ask` parts: Dreadful Strike): their name, in red,
 * above the target — like a failed save.
 */
function showStrikes(message) {
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  const sneak = message.getFlag(MODULE_ID, "sneak");
  const chosen = (message.getFlag(MODULE_ID, "bonuses") ?? []).filter(b => b.ask);
  if ( !sneak && !chosen.length ) return;
  const target = sneak?.target ?? message.system?.targets?.[0]?.token ?? null;
  if ( !target ) return;
  const texts = [];
  if ( sneak ) texts.push(loc("Retour.AttaqueSournoise", { n: sneak.dice, faces: sneak.faces }));
  for ( const b of chosen ) texts.push(loc("Retour.DegatsChoisis", { name: b.name }));
  show(texts.map(text => ({ token: target, kind: "strike", text })));
}

/**
 * §292: on everyone, an ability, skill or tool check rolled by dnd5e (`check` message, check-message-data.mjs
 * — §400: initiative too, separately): "15 · Athletics", and with a DC known for the roll (`options.target`: a DC hidden
 * from players sets none, adapter/group-roll.mjs) "15 · Athletics · Success". Above the token that rolled, after the 3D
 * dice; a private or blind roll is only shown to whoever can read it (`isContentVisible`).
 */
async function showCheck(message) {
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  const data = message.system ?? {};
  const roll = message.rolls?.[0];
  if ( !roll || !message.isContentVisible ) return;
  const actor = message.getAssociatedActor?.();
  const token = message.getAssociatedToken?.() ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
  if ( !token ) return;
  // §400, batch 2: initiative, its total above the token (setting "Show: initiative").
  if ( data.type === "initiative" ) {
    show([{ token: token.uuid, kind: "initiative", roll: roll.total, mode: d20Mode(roll), text: loc("Retour.Initiative"), waitFor: diceDone(message) }]);
    return;
  }
  const label = data.skill ? keyLabel({ type: "skill", key: data.skill })
    : data.tool ? keyLabel({ type: "tool", key: data.tool }) : keyLabel({ type: "check", key: data.ability });
  const kind = checkKind({ total: roll.total, target: roll.options?.target, isSuccess: roll.isSuccess, isFailure: roll.isFailure });
  const verdict = { checkSuccess: loc("Retour.TestReussi"), checkFail: loc("Retour.TestRate") }[kind];
  show([{ token: token.uuid, kind, roll: roll.total, mode: d20Mode(roll), text: [label, verdict].filter(Boolean).join(" · "), waitFor: diceDone(message) }]);
}

/**
 * §400: on everyone, a saving throw rolled by dnd5e outside an engine resolution (`save` message, data/chat-message/
 * save-message-data.mjs) — from the sheet, concentration, a death saving throw: "14 · Dexterity · Save succeeded", success or
 * failure when the roll carries a DC (`options.target`; 10 for a death saving throw). A save attached to an engine card
 * (`system.origin` bearing a resolution, adapter/saves.mjs) is already shown by the resolution: not twice. After the 3D
 * dice; a private or blind roll is only shown to whoever can read it.
 */
async function showSave(message) {
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready || ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  const data = message.system ?? {};
  const roll = message.rolls?.[0];
  if ( !roll || !message.isContentVisible ) return;
  // `system.origin` is a dnd5e document field (data/chat-message/roll-message-data.mjs:38): it returns the message, not its id —
  // the id is read in the source. Without this, the reroll of Searing Smite was displayed twice (seen by the user).
  const originId = message._source?.system?.origin ?? data.origin?.id ?? data.origin?._id ?? ((typeof data.origin === "string") ? data.origin : null);
  // The engine may mark its card a moment after the roll is created (Searing Smite reroll: `resave` at creation,
  // `resolution` just after): the reroll mark is enough, otherwise we ask again after a short delay.
  const byEngine = () => { const o = originId ? game.messages.get(originId) : null; return !!(o?.getFlag(MODULE_ID, "resolution") || o?.getFlag(MODULE_ID, "resave") || o?.getFlag(MODULE_ID, "areaTick")); };
  if ( byEngine() ) return;
  if ( originId ) {
    await new Promise(resolve => setTimeout(resolve, 400));
    if ( byEngine() ) return;
  }
  const actor = message.getAssociatedActor?.();
  const token = message.getAssociatedToken?.() ?? actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
  if ( !token ) return;
  const kind = saveKind({ total: roll.total, target: roll.options?.target, isSuccess: roll.isSuccess, isFailure: roll.isFailure });
  const label = (data.type === "death") ? loc("Retour.JetMort")
    : (data.type === "concentration") ? game.i18n.localize("DND5E.Concentration")
    : (CONFIG.DND5E.abilities[data.ability]?.label ?? data.ability ?? "");
  const verdict = { saveSuccess: loc("Retour.SauvegardeReussie"), saveFail: loc("Retour.SauvegardeRatee"), save: loc("Retour.Sauvegarde") }[kind];
  show([{ token: token.uuid, kind, roll: roll.total, mode: d20Mode(roll), text: [label, verdict].filter(Boolean).join(" · "), waitFor: diceDone(message) }]);
}

function onUpdateMessage(message, changes) {
  if ( !changes.flags?.[MODULE_ID]?.resolution ) return;
  const after = message.getFlag(MODULE_ID, "resolution");
  if ( !after ) return;
  const known = seen.has(message.id);
  const before = seen.get(message.id) ?? null;
  seen.set(message.id, foundry.utils.deepClone(after));
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  if ( !known && ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  show(feedbackBetween(before, after));
}

/**
 * §400: HP lost, restored or temporary, in place of dnd5e's text (documents/actor/actor.mjs:3532, `_displayTokenEffect`, turned off
 * with the core setting): same choice of kind and size (`hpFloat`), on each client — the hook is published by the actor update
 * everywhere (data/actor/templates/attributes.mjs:715). dnd5e still makes the token ring glow.
 */
function onHpChange(actor, changes) {
  if ( !floatsActive() || !canvas?.ready || !game.settings.get(MODULE_ID, "feedbackText") ) return;
  const max = actor?.system?.attributes?.hp?.max;
  const hp = hpFloat(changes, max);
  if ( !hp ) return;
  const tokens = (actor.isToken ? [actor.token] : actor.getActiveTokens(true, true)).filter(Boolean);
  const generic = () => show(tokens.map(t => ({ token: t.uuid, kind: hp.kind, text: hp.value.signedString(), factor: hp.factor })));
  if ( hp.kind !== "damage" ) return generic();
  // §400, batch 3: damage — the per-type detail, relayed by the client that applied it, arrives before or just after the HP
  // update; we wait for it a short moment. Without detail (damage entered by hand, detail lost): a single number, like dnd5e.
  setTimeout(() => {
    const entry = pendingDamage.get(actor.uuid);
    pendingDamage.delete(actor.uuid);
    if ( !entry || ((Date.now() - entry.at) > 3000) || !entry.parts.length ) return generic();
    const facts = [];
    for ( const t of tokens ) for ( const part of entry.parts ) {
      const factor = hpFloat({ hp: -part.value, temp: 0, total: -part.value }, max)?.factor ?? 1;
      facts.push({ token: t.uuid, kind: damageKind(part.type), text: `-${part.value}`, factor });
    }
    show(facts, { burst: true });
  }, DAMAGE_WAIT);
}

/**
 * §400, batch 3: the damage detail by type, taken from dnd5e's calculation on the client that applies it (`dnd5e.calculateDamage`:
 * each part has its value after Immunities, Resistances and Vulnerabilities, documents/actor/actor.mjs:957) and relayed to the
 * whole table just before the HP update (`dnd5e.preApplyDamage`, actor.mjs:819) — dnd5e's previews (damage card) also
 * calculate, but do not apply, and are not relayed. Nothing is written on the actor.
 */
const DAMAGE_QUERY = `${MODULE_ID}.damageParts`;
const DAMAGE_WAIT = 250;
const pendingDamage = new Map();
const lastCalculated = new Map();

function onCalculateDamage(actor, damages) {
  // The array itself: another listener can still modify it (split, reduction) before application.
  if ( actor?.uuid ) lastCalculated.set(actor.uuid, damages);
}

function onPreApplyDamage(actor) {
  const parts = damageParts(lastCalculated.get(actor?.uuid));
  lastCalculated.delete(actor?.uuid);
  if ( !parts?.length || !floatsActive() ) return;
  pendingDamage.set(actor.uuid, { parts, at: Date.now() });
  for ( const user of game.users ) {
    if ( !user.active || user.isSelf ) continue;
    user.query(DAMAGE_QUERY, { actor: actor.uuid, parts }, { timeout: 5000 }).catch(() => {});
  }
}

function receiveDamageParts({ actor, parts }={}) {
  if ( (typeof actor === "string") && Array.isArray(parts) ) {
    pendingDamage.set(actor, { parts: parts.filter(p => p && (typeof p.type === "string") && Number.isFinite(p.value)).slice(0, 14), at: Date.now() });
  }
  return true;
}

/**
 * §400: an effect that starts or ends, in place of the core's text
 * (documents/active-effect.mjs:995-1052, `_displayScrollingStatus`): same conditions — an effect that modifies the actor, a
 * condition or changes, without `animate: false` — and same text "+(Name)" / "−(Name)".
 */
function onEffect(effect, options, enabled) {
  if ( !floatsActive() || !canvas?.ready || !game.settings.get(MODULE_ID, "feedbackText") || (options?.animate === false) ) return;
  const actor = effect.target;
  // The core shows only an effect that applies a condition or changes the actor; §400: also a timed effect (spell, smite: Searing
  // Smite had no text at application or removal — seen by the user). An effect applied inactive (suspended) is not announced.
  if ( !(actor instanceof Actor) || !(effect.statuses?.size || effect.system?.changes?.length || effect.isTemporary) ) return;
  if ( enabled && !effect.active ) return;
  // §400: struck through, the lost condition is read by its name alone; without the bar, "−(Name)" like the core.
  const struck = !enabled && floatStyleOf(theme(), "effectOff").strike;
  const text = struck ? effect.name : `${enabled ? "+" : "−"}(${effect.name})`;
  show(actor.getActiveTokens(true).map(t => ({ token: t.document.uuid, kind: enabled ? "effectOn" : "effectOff", text })));
}

/**
 * §400: the active GM aligns the core setting "scrolling text" (world) with the engine's switch: engine texts → the core's and
 * the system's (dnd5e HP, effects, region behavior "scrolling text") turned off; engine off → restored, if it had turned
 * them off itself.
 */
async function syncCoreText() {
  if ( !isExecutor() ) return;
  const core = game.settings.get("core", "scrollingStatusText");
  if ( floatsActive() ) {
    if ( core ) {
      await game.settings.set(MODULE_ID, CORE_MUTED, true);
      await game.settings.set("core", "scrollingStatusText", false);
    }
  } else if ( game.settings.get(MODULE_ID, CORE_MUTED) ) {
    await game.settings.set(MODULE_ID, CORE_MUTED, false);
    if ( !core ) await game.settings.set("core", "scrollingStatusText", true);
  }
}

/** §400: the free fonts (OFL) shipped for the theme, loaded by the core with its own before the canvas (game.mjs:1065). */
const FONTS = {
  "Cinzel": [{ urls: [`modules/${MODULE_ID}/fonts/cinzel.ttf`], weight: "400 900" }],
  "Cormorant Garamond": [{ urls: [`modules/${MODULE_ID}/fonts/cormorant-garamond.ttf`], weight: "300 700" }],
  "Alegreya SC": [{ urls: [`modules/${MODULE_ID}/fonts/alegreya-sc-medium.ttf`], weight: "500" },
    { urls: [`modules/${MODULE_ID}/fonts/alegreya-sc-bold.ttf`], weight: "700" }]
};

/** This world's font families: the core's and the modules', and those the GM added (Additional Fonts). */
export function floatFonts() {
  let added = {};
  try { added = game.settings.get("core", "fonts") ?? {}; } catch {}
  return [...new Set([...Object.keys(CONFIG.fontDefinitions ?? {}), ...Object.keys(added)])].sort((a, b) => a.localeCompare(b));
}

/** §400: replays a kind on a token (trial from the theme window, `api.floats.play`). */
export function playFloat(token, kind, text, extra={}) {
  const placeable = (typeof token === "string") ? fromUuidSync(token)?.object : (token?.object ?? token);
  if ( !placeable ) return false;
  themeCache = null;
  show([{ token: placeable.document.uuid, kind, text, ...extra }]);
  return true;
}

export function registerFeedback() {
  if ( CONFIG.fontDefinitions ) for ( const [family, fonts] of Object.entries(FONTS) ) CONFIG.fontDefinitions[family] ??= { editor: true, fonts };
  // §400: the table's switch, the theme, and the trace of having turned off the core's text.
  game.settings.register(MODULE_ID, FLOAT_SYSTEM, { scope: "world", config: true, type: Boolean, default: true,
    name: `DND5ECOMBAT.Reglage.${FLOAT_SYSTEM}.Nom`, hint: `DND5ECOMBAT.Reglage.${FLOAT_SYSTEM}.Aide`, onChange: () => syncCoreText() });
  game.settings.register(MODULE_ID, CORE_MUTED, { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, THEME_SETTING, { scope: "world", config: false, type: Object, default: {},
    onChange: () => { themeCache = null; } });
  game.settings.register(MODULE_ID, "feedbackText", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.feedbackText.Nom", hint: "DND5ECOMBAT.Reglage.feedbackText.Aide" });
  // §400 : les sons de l'hexagone, sur ce poste.
  game.settings.register(MODULE_ID, "floatSounds", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.floatSounds.Nom", hint: "DND5ECOMBAT.Reglage.floatSounds.Aide" });
  game.settings.register(MODULE_ID, "floatSoundVolume", { scope: "client", config: true, type: Number, default: 40,
    range: { min: 0, max: 100, step: 5 }, name: "DND5ECOMBAT.Reglage.floatSoundVolume.Nom", hint: "DND5ECOMBAT.Reglage.floatSoundVolume.Aide" });
  // The active GM is only known a little after `ready` (`game.users.activeGM`): the core setting is aligned afterwards.
  route("ready", () => { setTimeout(() => syncCoreText().catch(() => {}), 1500); }, { always: true, label: "floating texts: system texts muted" });
  route("dnd5e.damageActor", onHpChange, { always: true, label: "floating texts: hit points" });
  route("dnd5e.healActor", onHpChange, { always: true, label: "floating texts: hit points" });
  route("createActiveEffect", (e, o) => { if ( e.modifiesActor ) onEffect(e, o, true); }, { always: true, label: "floating texts: effect" });
  route("deleteActiveEffect", (e, o) => { if ( e.modifiesActor ) onEffect(e, o, false); }, { always: true, label: "floating texts: effect" });
  route("updateActiveEffect", (e, changed, o) => { if ( "disabled" in (changed ?? {}) ) onEffect(e, o, e.active); },
    { always: true, label: "floating texts: effect" });
  // §228: the pace and content of the texts, for the table (GM).
  const world = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  world("floatDuration", { type: Number, default: FLOAT_DEFAULTS.duration, range: { min: 1, max: 10, step: 0.5 } });
  world("floatSpacing", { type: Number, default: FLOAT_DEFAULTS.spacing, range: { min: 0.2, max: 3, step: 0.1 } });
  world("floatDistance", { type: Number, default: FLOAT_DEFAULTS.distance, range: { min: 0.5, max: 4, step: 0.25 } });
  world("floatDirection", { type: String, default: FLOAT_DEFAULTS.direction,
    choices: { down: "DND5ECOMBAT.Reglage.floatDirection.down", up: "DND5ECOMBAT.Reglage.floatDirection.up" } });
  world("floatScale", { type: Number, default: FLOAT_DEFAULTS.scale, range: { min: 50, max: 250, step: 10 } });
  world("floatDice", { type: Boolean, default: true });
  world("floatIcons", { type: Boolean, default: true });
  for ( const [key, value] of Object.entries(FLOAT_CATEGORY_DEFAULTS) ) world(key, { type: Boolean, default: value });
  route("updateChatMessage", onUpdateMessage, { label: "visual feedback above tokens" });
  route("deleteChatMessage", message => seen.delete(message.id), { label: "visual feedback: forget" });
  route(`${MODULE_ID}.notice`, n => {
    floatNotice(n.token, n.text, n.kind);
    if ( n.kind === "heroic" ) heroicBurst(n.token).catch(() => {});
    // Issue #32: the accepted success at a cost — the same flash, amber, with the scales.
    if ( n.kind === "atCost" ) heroicBurst(n.token, { color: 0xe0a050, icon: "icons/svg/aura.svg" }).catch(() => {});
    // §408: "Forced" no longer has a flash (issue #178, user's request 2026-11-21: too prominent) — the text alone, discreet.
  }, { label: "visual feedback: engine notice" });
  // §252: the notice of an action from another client (runtime/shared.mjs, `notice(…, { all: true })`), drawn here.
  CONFIG.queries[NOTICE_QUERY] = receiveNotice;
  // §400, batch 3: the damage detail by type.
  CONFIG.queries[DAMAGE_QUERY] = receiveDamageParts;
  route("dnd5e.calculateDamage", onCalculateDamage, { always: true, label: "floating texts: damage by type" });
  route("dnd5e.preApplyDamage", onPreApplyDamage, { always: true, label: "floating texts: damage by type" });
  route("createChatMessage", onCreateMessage, { label: "visual feedback: effect ending" });
}
