/**
 * §228: the texts that scroll above tokens (visual feedback, ui/feedback.mjs) — their pace and what they show, set by the GM
 * for the table ("Floating texts" tab). Table feedback of 2026-10-21: too fast, too tight, often unreadable.
 *
 * Pure: no dependency on Foundry.
 */

/** The setting category of each kind of fact (core/feedback.mjs, ui/feedback.mjs). */
export const FLOAT_CATEGORIES = Object.freeze({
  hit: "floatHits",
  critical: "floatAttacks", miss: "floatAttacks",
  cover: "floatCover",
  saveSuccess: "floatSaves", saveFail: "floatSaves",
  reaction: "floatReactions",
  prompt: "floatPrompts", refused: "floatPrompts", forced: "floatPrompts",   // §408: a rule overridden
  ended: "floatEffects", unaffected: "floatEffects", duplicate: "floatEffects",
  gain: "floatResources", spend: "floatResources",
  strike: "floatStrikes",
  check: "floatChecks", checkSuccess: "floatChecks", checkFail: "floatChecks",
  initiative: "floatInitiative",   // §400, lot 2
  save: "floatSaves"   // §400: a save from the sheet with no known DC
});

/** The category settings, in the order of the window, with their default value. */
export const FLOAT_CATEGORY_DEFAULTS = Object.freeze({
  floatAttacks: true, floatHits: false, floatAdvantage: true, floatSaves: true, floatChecks: true, floatCover: true, floatReactions: true, floatStrikes: true,
  floatEffects: true, floatResources: true, floatPrompts: true, floatInitiative: true
});

/** The default pace: duration (s), gap between two texts of the same token (s), travel (cells), size (%). */
export const FLOAT_DEFAULTS = Object.freeze({ duration: 4, spacing: 1, distance: 1.5, scale: 100, direction: "down" });

/** The kinds whose icon is that of a die (the roll result, `floatDice` setting). */
const ROLLED = new Set(["hit", "critical", "miss", "saveSuccess", "saveFail", "check", "checkSuccess", "checkFail", "initiative", "save"]);

/**
 * §400: the kind of the text of a save rolled by dnd5e outside the engine (sheet, concentration, death save) — success, failure, or
 * neutral (`save`) with no known DC; same reading as `checkKind`.
 * @returns {"save"|"saveSuccess"|"saveFail"}
 */
export function saveKind(roll) {
  return { check: "save", checkSuccess: "saveSuccess", checkFail: "saveFail" }[checkKind(roll)];
}

/**
 * §292: the kind of the text of an ability check, skill check or tool check rolled by dnd5e, from its d20 — success or failure
 * when the roll carries a DC (`options.target`, dice/d20-roll.mjs `isSuccess` / `isFailure`), otherwise the total alone.
 * @param {{total: number, target?: number|null, isSuccess?: boolean, isFailure?: boolean}} roll
 * @returns {"check"|"checkSuccess"|"checkFail"}
 */
export function checkKind(roll) {
  const target = roll?.target;
  if ( (target === null) || (target === undefined) || (target === "") || !Number.isFinite(Number(target)) ) return "check";
  if ( roll.isSuccess === true ) return "checkSuccess";
  if ( roll.isFailure === true ) return "checkFail";
  return (Number(roll.total) >= Number(roll.target)) ? "checkSuccess" : "checkFail";
}

/**
 * What a line shows: its text, the roll number and the icons — or null if its category is off. A hit that lands without a
 * critical has no text of its own: it shows only through its roll (`floatDice`) or through "Hit" (`floatHits`).
 * @param {{kind: string, roll?: number|null}} fact
 * @param {string|null} text        The localized text of the fact ("Miss"), or null.
 * §231: the d20 mode (`fact.mode`), "Advantage" / "Disadvantage" (`modeText`), is added to the roll when `floatAdvantage`
 * asks for it — without the total (`floatDice` off), it comes before the verdict. `mode` in the line: for the color of the word.
 * @param {object} options          `show` (category → boolean), `dice`, `icons`, `hitText` ("Hit"), `modeText` (mode → word).
 * @returns {{text: string, roll: number|null, dieIcon: boolean, icon: string|null, mode: string|null}|null}
 */
export function floatLine(fact, text, { show={}, dice=true, icons=true, hitText=null, modeText={} }={}) {
  const category = FLOAT_CATEGORIES[fact.kind];
  if ( !category ) return text ? { text, roll: null, dieIcon: false, icon: null, mode: null } : null;
  const roll = (dice && ROLLED.has(fact.kind) && Number.isFinite(fact.roll)) ? fact.roll : null;
  const showMode = show.floatAdvantage ?? FLOAT_CATEGORY_DEFAULTS.floatAdvantage;
  const mode = (showMode && ROLLED.has(fact.kind) && modeText[fact.mode]) ? fact.mode : null;
  const on = show[category] ?? FLOAT_CATEGORY_DEFAULTS[category];
  if ( fact.kind === "hit" ) {
    if ( !on && (roll === null) && !mode ) return null;
    return { text: on ? (hitText ?? "") : "", roll, dieIcon: ((roll !== null) || !!mode) && icons, icon: null, mode };
  }
  if ( !on || !text ) return null;
  return { text, roll, dieIcon: ((roll !== null) || !!mode) && icons, icon: icons ? (ICONS[fact.kind] ?? null) : null, mode };
}

/**
 * §231: the label of a line — roll total and mode ("17 with Advantage"), then the text: "17 with Advantage · Miss".
 * @param {{text: string, roll: number|null, mode: string|null}} line
 * @param {Record<string, string>} modeText  mode → "Advantage" / "Disadvantage".
 * @param {string} [joiner]  The word between the total and the mode ("with").
 */
export function floatLabel(line, modeText={}, joiner="") {
  const mode = line.mode ? modeText[line.mode] : null;
  const head = Number.isFinite(line.roll) ? (mode ? `${line.roll} ${joiner ? `${joiner} ` : ""}${mode}` : String(line.roll)) : mode;
  return [head || null, line.text || null].filter(Boolean).join(" · ");
}

/** Icons specific to a kind (core icons: public/icons/svg). */
const ICONS = { cover: "icons/svg/shield.svg", reaction: "icons/svg/lightning.svg", critical: "icons/svg/explosion.svg", saveFail: "icons/svg/skull.svg" };

/**
 * One frame of the animation, at progress `p` (0 → 1): the text appears (15 % of the time, growing), stays readable, then
 * fades out over the last third only — the core fades it during its whole travel (interface.mjs, `createScrollingText`).
 * The travel is smoothed over the whole duration.
 * @returns {{alpha: number, offset: number, scale: number}}  `offset`: part of the travel done (0 → 1).
 */
export function floatFrame(p) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  const ease = x => 0.5 - (Math.cos(Math.PI * x) / 2);
  const alpha = (t < 0.15) ? ease(t / 0.15) : (t > 0.67) ? 1 - ease((t - 0.67) / 0.33) : 1;
  const scale = (t < 0.15) ? 0.6 + (0.4 * ease(t / 0.15)) : 1;
  return { alpha, offset: ease(t), scale };
}

/**
 * The appearance delays of a burst of texts: each token has its queue, a text waits until the previous one of the same token has
 * taken `spacing` seconds of lead (including those still running from a previous burst, `busyUntil`).
 * @param {string[]} tokens          The token of each text, in order.
 * @param {number} spacing           Seconds.
 * @param {number} now               Clock in ms.
 * @param {Map<string, number>} busyUntil  Per token, the time (ms) when the next one may start; updated.
 * @returns {number[]}  The delay (ms) of each text.
 */
export function floatDelays(tokens, spacing, now, busyUntil) {
  const gap = Math.max(0, Number(spacing) || 0) * 1000;
  return tokens.map(token => {
    const start = Math.max(now, busyUntil.get(token) ?? 0);
    busyUntil.set(token, start + gap);
    return start - now;
  });
}

/* -------------------------------------------- */
/*  §400: the floating text theme                */
/* -------------------------------------------- */

/*
 * §400: each kind of text has its own look (font, color, outline, glow, icon and its frame, appearance, path), set for the
 * table by an imported JSON (the "Floating text workshop", format `das-float-theme`). HP (`damage`, `healing`, `temp`) and
 * effects that start or end (`effectOn`, `effectOff`) are drawn by the engine when its floating texts replace those of the
 * system (`floatSystem` setting). The `dmg-<type>` (damage by type) and the spinning hexagon (`spin`) are kept on import for
 * the next batches, with no effect for now.
 */

/** The theme icons: a workshop name → a core icon (public/icons/svg). An image path is also accepted. */
export const FLOAT_ICONS = Object.freeze({
  none: null, d20: "icons/svg/d20.svg", shield: "icons/svg/shield.svg", lightning: "icons/svg/lightning.svg", explosion: "icons/svg/explosion.svg",
  skull: "icons/svg/skull.svg", sun: "icons/svg/sun.svg", hand: "icons/svg/holy-shield.svg", sword: "icons/svg/sword.svg", heart: "icons/svg/heal.svg",
  moon: "icons/svg/sleep.svg", eye: "icons/svg/eye.svg", ban: "icons/svg/cancel.svg", hourglass: "icons/svg/clockwork.svg", plus: "icons/svg/upgrade.svg",
  minus: "icons/svg/downgrade.svg", star: "icons/svg/aura.svg", target: "icons/svg/target.svg"
});

/** The starting look of each kind: that of the engine before the theme (ui/feedback.mjs, STYLES and icons). */
const BASE = {
  critical: ["#ffd24a", 30, "explosion"], miss: ["#d0d0d0", 24, "none"], hit: ["#ffffff", 22, "none"], cover: ["#9ecbff", 20, "shield"],
  reaction: ["#c49bff", 22, "lightning"], saveSuccess: ["#8fd18f", 22, "none"], saveFail: ["#e07a6a", 22, "skull"],
  duplicate: ["#c49bff", 22, "none"], unaffected: ["#d0d0d0", 20, "none"], prompt: ["#ffb347", 24, "none"], refused: ["#ff7070", 22, "none"], forced: ["#ff9a3c", 20, "none"],
  ended: ["#9ecbff", 20, "none"], gain: ["#8fd18f", 22, "none"], spend: ["#ffb347", 20, "none"], strike: ["#e0453a", 26, "none"],
  heroic: ["#ffd24a", 28, "none"], atCost: ["#e0a050", 26, "none"], check: ["#f0e6c8", 22, "none"], checkSuccess: ["#8fd18f", 22, "none"],
  checkFail: ["#e07a6a", 22, "none"], initiative: ["#f0e6c8", 22, "none"], save: ["#f0e6c8", 22, "none"],
  // §400: what the system drew (dnd5e `tokenHPColors`, documents/actor/actor.mjs:3557; core, active-effect.mjs:1039).
  damage: ["#ff3030", 28, "none"], healing: ["#30ff50", 28, "none"], temp: ["#66ccff", 26, "none"],
  effectOn: ["#f0e6c8", 22, "none"], effectOff: ["#a8a29a", 20, "none"],
  // §400, batch 3: damage by type (dnd5e `CONFIG.DND5E.damageTypes`), in the color of the type — same hues as the workshop.
  "dmg-acid": ["#a5e03a", 28, "none"], "dmg-bludgeoning": ["#ece6da", 28, "none"], "dmg-cold": ["#8fdcff", 28, "none"],
  "dmg-fire": ["#ff7a2a", 28, "none"], "dmg-force": ["#e866d8", 28, "none"], "dmg-lightning": ["#5e8bff", 28, "none"],
  "dmg-necrotic": ["#5fcf9f", 28, "none"], "dmg-piercing": ["#ece6da", 28, "none"], "dmg-poison": ["#4fcf5f", 28, "none"],
  "dmg-psychic": ["#ff7cc0", 28, "none"], "dmg-radiant": ["#ffe47a", 28, "none"], "dmg-slashing": ["#ece6da", 28, "none"],
  "dmg-thunder": ["#b39bff", 28, "none"]
};
/** §400, batch 3: the damage types that have their own kind (`dmg-<type>`). */
export const DAMAGE_KINDS = Object.freeze(Object.keys(BASE).filter(k => k.startsWith("dmg-")).map(k => k.slice(4)));
/** The kinds the theme knows, in the order of the window. */
export const FLOAT_KINDS = Object.freeze(Object.keys(BASE));

const SEGMENTS = {
  weight: [400, 500, 600, 700], badge: ["none", "hex", "circle"], entrance: ["fade", "grow", "pop", "slide"], motion: ["float", "anchor", "arc"]
};
const RANGES = { size: [10, 64], tracking: [0, 0.4], strokeW: [0, 10], glow: [0, 30], spread: [0.2, 3], spinMs: [200, 3000] };
const COLORS = ["color", "stroke", "glowColor", "badgeColor", "badgeBorder", "okColor", "failColor"];
const FLAGS = ["show", "upper", "italic", "spin", "strike"];

/** The default look of a kind (core font, Signika). */
export function floatStyleDefault(kind) {
  const [color, size, icon] = BASE[kind] ?? ["#f0e6c8", 22, "none"];
  // §400, batch 3: lost HP go off in an arc to the side, in bold, with a bounce (BG3); the rest scrolls as before.
  const hit = (kind === "damage") || kind.startsWith("dmg-");
  return { show: true, color, size, font: "Signika", weight: hit ? 700 : 600, upper: false, tracking: 0, italic: false, stroke: "#000000", strokeW: 4,
    glow: 0, glowColor: color, icon, badge: "none", badgeColor: "#1a1a1a", badgeBorder: color, entrance: hit ? "pop" : "grow", motion: hit ? "arc" : "float", spread: 1,
    spin: false, spinMs: 900, okColor: "#3f9cff", failColor: "#e0453a",
    // §400: a lost condition is struck through — the bar crosses the text from left to right (user request).
    strike: kind === "effectOff" };
}

/** A `#rrggbb` color, or null. */
function hexColor(value) {
  return ((typeof value === "string") && /^#[0-9a-f]{6}$/i.test(value)) ? value.toLowerCase() : null;
}

/**
 * A look read from a JSON: each field checked, bounded, or ignored; what is missing keeps the default value. The workshop's font
 * names ("Signika (Foundry)") are reduced to the family; a font unknown to this world (`fonts`) is refused.
 * @param {object} raw
 * @param {string} kind
 * @param {{fonts?: string[]}} [options]
 * @returns {{style: object, problems: string[]}}
 */
export function floatStyleFrom(raw, kind, { fonts=null }={}) {
  const style = floatStyleDefault(kind);
  const problems = [];
  if ( !raw || (typeof raw !== "object") ) return { style, problems };
  for ( const key of COLORS ) if ( key in raw ) {
    const c = hexColor(raw[key]);
    if ( c ) style[key] = c; else problems.push(`${kind}.${key}`);
  }
  for ( const key of FLAGS ) if ( typeof raw[key] === "boolean" ) style[key] = raw[key];
  for ( const [key, [min, max]] of Object.entries(RANGES) ) if ( key in raw ) {
    const n = Number(raw[key]);
    if ( Number.isFinite(n) ) style[key] = Math.min(max, Math.max(min, n)); else problems.push(`${kind}.${key}`);
  }
  for ( const [key, values] of Object.entries(SEGMENTS) ) if ( key in raw ) {
    const v = (key === "weight") ? Number(raw[key]) : raw[key];
    if ( values.includes(v) ) style[key] = v; else problems.push(`${kind}.${key}`);
  }
  if ( "icon" in raw ) {
    const icon = raw.icon;
    if ( (icon in FLOAT_ICONS) || ((typeof icon === "string") && /\.(svg|webp|png|jpe?g)$/i.test(icon)) ) style.icon = icon;
    else problems.push(`${kind}.icon`);
  }
  if ( typeof raw.font === "string" ) {
    const font = raw.font.replace(/\s*\(.*\)\s*$/, "").trim();
    if ( !fonts || fonts.includes(font) ) style.font = font; else problems.push(`${kind}.font: ${font}`);
  }
  return { style, problems };
}

/** The pace settings a theme can carry, with their bounds (those of the world settings, ui/feedback.mjs). */
export const FLOAT_GLOBAL_RANGES = Object.freeze({
  floatDuration: [1, 10], floatSpacing: [0.2, 3], floatDistance: [0.5, 4], floatScale: [50, 250]
});

/**
 * An imported theme: the workshop's JSON (`format: "das-float-theme"`) or a `{ types }` object. Returns the looks of the kinds
 * (a kind the engine does not draw yet, like `dmg-fire`, is kept for later), the bounded pace settings, and what was refused.
 * @param {object|string} json
 * @param {{fonts?: string[]}} [options]
 * @returns {{theme: Record<string, object>, global: Record<string, number|string|boolean>, problems: string[]}}
 */
export function floatThemeFrom(json, { fonts=null }={}) {
  const data = (typeof json === "string") ? JSON.parse(json) : json;
  if ( !data || (typeof data !== "object") || !data.types || (typeof data.types !== "object") ) throw new Error("expected { types: { … } }");
  if ( data.format && (data.format !== "das-float-theme") ) throw new Error(`unknown format ${data.format}`);
  const theme = {};
  const problems = [];
  for ( const [kind, raw] of Object.entries(data.types) ) {
    if ( !/^[a-zA-Z][\w-]{0,40}$/.test(kind) ) { problems.push(kind); continue; }
    const result = floatStyleFrom(raw, kind, { fonts });
    theme[kind] = result.style;
    problems.push(...result.problems);
  }
  const global = {};
  const g = data.global ?? {};
  for ( const [key, [min, max]] of Object.entries(FLOAT_GLOBAL_RANGES) ) if ( key in g ) {
    const n = Number(g[key]);
    if ( Number.isFinite(n) ) global[key] = Math.min(max, Math.max(min, n));
  }
  if ( ["up", "down"].includes(g.floatDirection) ) global.floatDirection = g.floatDirection;
  for ( const key of ["floatDice", "floatIcons", "floatAdvantage"] ) if ( typeof g[key] === "boolean" ) global[key] = g[key];
  return { theme, global, problems };
}

/** The export theme: all known kinds, with their current look. */
export function floatThemeExport(theme={}, global={}) {
  const types = {};
  for ( const kind of new Set([...FLOAT_KINDS, ...Object.keys(theme)]) ) types[kind] = { ...floatStyleDefault(kind), ...(theme[kind] ?? {}) };
  return { format: "das-float-theme", version: 1, global, types };
}

/** The look of a kind according to the world theme (what is missing: the default value). */
/** §400: a kind the workshop does not know takes, if the theme does not define it, the look of a neighbor (same hexagon). */
const STYLE_FALLBACK = Object.freeze({ save: "saveSuccess" });
/**
 * §400: ability checks, skill checks and tool checks always have the look of saves (user request: same animation) — success like a
 * successful save, failure like a failed one, with no DC like a save with no DC. Their outcome keeps its border color
 * (`floatOutcome` reads the kind of the check).
 */
const STYLE_ALIAS = Object.freeze({ check: "save", checkSuccess: "saveSuccess", checkFail: "saveFail" });

export function floatStyleOf(theme, kind) {
  if ( STYLE_ALIAS[kind] ) return floatStyleOf(theme, STYLE_ALIAS[kind]);
  const own = theme?.[kind] ?? (STYLE_FALLBACK[kind] ? theme?.[STYLE_FALLBACK[kind]] : null);
  return { ...floatStyleDefault(kind), ...(own ?? {}) };
}

const easeInOut = x => 0.5 - (Math.cos(Math.PI * x) / 2);

/**
 * The offset of a text at progress `p` (0 → 1), according to its path: `float` runs `travel` (px, signed), `anchor` stays in place,
 * `arc` goes off to the side (`side` ±1, `spread` px), rises by `rise` px then falls back by `drop` px.
 * @returns {{dx: number, dy: number}}
 */
export function floatOffset(p, motion, { travel=0, side=1, spread=0, rise=0, drop=0 }={}) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  if ( motion === "anchor" ) return { dx: 0, dy: 0 };
  if ( motion === "arc" ) return { dx: side * spread * easeInOut(Math.min(1, t * 1.25)), dy: (-rise * 4 * t * (1 - t)) + (t * drop) };
  return { dx: 0, dy: travel * easeInOut(t) };
}

/** The scale and the appearance slide at progress `p`, according to the chosen entrance (`grow`: that of `floatFrame`). */
export function floatEntrance(p, entrance) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  if ( entrance === "pop" ) return { scale: (t < 0.1) ? 0.4 + easeInOut(t / 0.1) : (t < 0.2) ? 1.4 - (0.4 * easeInOut((t - 0.1) / 0.1)) : 1, dx: 0 };
  if ( entrance === "slide" ) return { scale: 1, dx: (t < 0.15) ? -30 * (1 - easeInOut(t / 0.15)) : 0 };
  if ( entrance === "fade" ) return { scale: 1, dx: 0 };
  return { scale: (t < 0.15) ? 0.6 + (0.4 * easeInOut(t / 0.15)) : 1, dx: 0 };
}

/**
 * §400: the text of an HP change, as dnd5e chooses it (documents/actor/actor.mjs:3532, `_displayTokenEffect`): damage if
 * HP go down, healing if they go up, Temporary Hit Points otherwise; the size follows the share of max HP
 * (dnd5e: 16 → 48 px, here × 0.6 → 1.8).
 * @param {{hp: number, temp: number, total: number}} changes
 * @param {number} max   Max HP.
 * @returns {{kind: "damage"|"healing"|"temp", value: number, factor: number}|null}
 */
export function hpFloat(changes, max) {
  let kind = null;
  let value = 0;
  if ( changes?.hp < 0 ) { kind = "damage"; value = changes.total; }
  else if ( changes?.hp > 0 ) { kind = "healing"; value = changes.total; }
  else if ( changes?.temp ) { kind = "temp"; value = changes.temp; }
  if ( !kind || !value ) return null;
  const pct = Math.min(1, Math.max(0, Math.abs(value) / (Number(max) || Math.abs(value))));
  return { kind, value, factor: 0.6 + (1.2 * pct) };
}

/**
 * §400, batch 2: the outcome of a roll, for the border of the spinning hexagon — "ok" (blue by default), "fail" (red),
 * or null (neutral: check with no DC, Initiative), the border then keeping its color.
 * @param {string} kind
 * @returns {"ok"|"fail"|null}
 */
export function floatOutcome(kind) {
  if ( ["saveSuccess", "checkSuccess", "critical", "hit"].includes(kind) ) return "ok";
  if ( ["saveFail", "checkFail", "miss"].includes(kind) ) return "fail";
  return null;
}

/** §400, batch 2: does the kind carry a roll (its total goes in the hexagon)? */
export function floatRolled(kind) {
  return ROLLED.has(kind);
}

/**
 * §400, batch 2: the phase of the hexagon at `ms` milliseconds: it spins for `spinMs` (`angle` in radians, about one turn
 * per second), then reveals itself — `pulse` (1.4 → 1 over 240 ms) and `text` (text opacity, 0 → 1 over 260 ms).
 * @returns {{spinning: boolean, angle: number, pulse: number, text: number}}
 */
export function spinPhase(ms, spinMs) {
  const t = Math.max(0, Number(ms) || 0);
  if ( t < spinMs ) return { spinning: true, angle: t * 0.0157, pulse: 1, text: 0 };
  const after = t - spinMs;
  return { spinning: false, angle: 0, pulse: 1 + (0.4 * Math.max(0, 1 - (after / 240))), text: Math.min(1, after / 260) };
}

/**
 * §400, batch 3: the damage taken, by type, from dnd5e's result after Immunities, Resistances and Vulnerabilities
 * (documents/actor/actor.mjs, `calculateDamage`: each part has its final `value` and its `type`). Healing, Temporary Hit
 * Points and maximum are discarded; the same type is summed; the highest first.
 * @param {Array<{type: string, value: number}>} damages
 * @returns {Array<{type: string, value: number}>}
 */
export function damageParts(damages) {
  const sums = new Map();
  for ( const d of damages ?? [] ) {
    const value = Math.trunc(Number(d?.value) || 0);
    if ( !d?.type || (value <= 0) || ["healing", "temphp", "maximum"].includes(d.type) ) continue;
    sums.set(d.type, (sums.get(d.type) ?? 0) + value);
  }
  return [...sums].map(([type, value]) => ({ type, value })).sort((a, b) => b.value - a.value);
}

/** §400, batch 3: the kind of a damage type — its own if it has one, otherwise "damage". */
export function damageKind(type) {
  return DAMAGE_KINDS.includes(type) ? `dmg-${type}` : "damage";
}

/**
 * §400: the struck-through part of the text at `ms` milliseconds after it appears — the bar waits until the text is there
 * (`delay`), then crosses it from left to right over `length` ms, slowing down at the end.
 * @returns {number}  0 → 1.
 */
export function strikeProgress(ms, { delay=350, length=450 }={}) {
  const t = Math.min(1, Math.max(0, ((Number(ms) || 0) - delay) / length));
  return 1 - ((1 - t) ** 3);
}

/**
 * §400: the bare name of an effect ending, to recognize two announcements of the same ending — the non-struck removal
 * is written "−(Name)".
 * @returns {string}  In lowercase.
 */
export function floatEndName(text) {
  return String(text).replace(/^[−+]\((.*)\)$/, "$1").toLocaleLowerCase();
}
