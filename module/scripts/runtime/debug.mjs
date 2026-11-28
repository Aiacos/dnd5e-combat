/**
 * §380 (issue #36): the built-in debugger — the capture, on each client.
 *  - From the script load (before `init`, to also see startup errors): `console.error` / `console.warn`
 *    wrapped, `window` "error" and "unhandledrejection". The router also reports each registrant that fails, with its
 *    label and its hook (`noteRouterError`); the same error is then not collected a second time by the console.
 *  - By default, only the errors where a suite module appears (stack, or message prefixed "<id> | ") are kept
 *    (CLIENT setting `debugAllModules`: all). CLIENT setting `debugCapture`: off, nothing is wrapped anymore.
 *  - The trail: the last 50 DAS gestures of this client (activities used, resolutions, refused operations, turns, scenes),
 *    described by identifiers; each new error freezes the last 10. Neighbors add theirs (`api.debug.trail`).
 *  - Verbose mode (in memory, until reload): the console lines of the suite's modules kept as well (300).
 *  - A client that is not the active GM sends it, every 3 s at most, what is new (`DEBUG_QUERY` request).
 * Nothing is written to the world; nothing leaves the table without a click in the report window (ui/debug-report.mjs, batch 3).
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { attribute, buildReport, createErrorLog, createRing, createScrubber, errorIn, formatArgs, githubRepo, isBareStack, isBrowserNoise, isDeprecation,
  noticeMatcher, translationTexts, packagesOfStack, pickRepo, reportMarkdown, roleLabels, safeSettings } from "../core/debug.mjs";
import { isSuiteTitle } from "../core/settings-layout.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { reports as itemReports } from "../adapter/automation.mjs";
import { route } from "./router.mjs";

export const DEBUG_CAPTURE_SETTING = "debugCapture";
export const DEBUG_ALL_SETTING = "debugAllModules";
export const DEBUG_QUERY = `${MODULE_ID}.debug`;
export const DEBUG_VERBOSE_QUERY = `${MODULE_ID}.debugVerbose`;
/**
 * §380: on each client, at Foundry's `setup` (even with the engine on standby): `(debugApi)`, the debugger —
 * a neighbor declares itself there (`register`) and adds its gestures to the trail (`trail`).
 */
export const DEBUG_HOOK = `${MODULE_ID}.debug`;
/** A probe for scenarios: a router registrant that fails on purpose (message "DAS debug probe …"). */
export const DEBUG_PROBE_HOOK = `${MODULE_ID}.debugProbe`;
export const PROBE_MARK = "DAS debug probe";
export const RELAY_MS = 3000;

const SELF_FILE = `${MODULE_ID}/scripts/runtime/debug.mjs`;
const IGNORE = [SELF_FILE, "lib-wrapper"];
/** The stack of a console line written by `ui.notifications` (foundry.mjs, Notifications#notify). */
const NOTIFICATION = /\bNotifications\.(?:notify|info|warn|error)\b/;

const errors = createErrorLog();
const trailRing = createRing(50);
const logRing = createRing(300);
const registered = new Map();     // module → { module, repo, collect }
const listeners = new Set();
const state = { installed: false, enabled: true, all: false, verbose: false, busy: false, pending: [], timer: null, original: null };
let lastRouterError = null;
/** The labels of the open console groups (`console.group` / `groupCollapsed`), the most recent last. */
const consoleGroups = [];

/* -------------------------------------------- */
/*  Filtre                                      */
/* -------------------------------------------- */

/** A suite package: title "DAS · …" or registered by `api.debug.register`. Before the modules are read: yes. */
export function isSuitePackage(id) {
  if ( !id || id.startsWith("system:") ) return false;
  if ( (id === MODULE_ID) || registered.has(id) ) return true;
  const modules = globalThis.game?.modules;
  if ( !modules?.get ) return true;
  return isSuiteTitle(modules.get(id)?.title);
}

/** The "<id> | " prefix of a console message, if it names a suite module. */
function prefixed(message) {
  const m = /^([a-z0-9][\w-]*) \|/i.exec(message);
  return m && isSuitePackage(m[1]) ? m[1] : null;
}

/** Does an error concern the suite? The attributed package, then the message prefix. */
function concernsSuite(modules, message) {
  return modules.some(isSuitePackage) || !!prefixed(message);
}

/* -------------------------------------------- */
/*  Survey                                      */
/* -------------------------------------------- */

const userId = () => globalThis.game?.user?.id ?? globalThis.game?.userId ?? null;

/** Errors thrown before the module list is readable: sorted at `init` (`replayEarly`), 50 at most. */
const early = [];
const modulesReadable = () => typeof globalThis.game?.modules?.get === "function";

/** At `init`: startup errors go through the suite's sorting, like the others. */
export function replayEarly() {
  for ( const entry of early.splice(0) ) recordError(entry);
}

/**
 * An error collected on this client. The fields: `{ kind, message, stack, label, hook, module }`.
 * @returns {object|null} the group, or null if the error is outside the suite (and the setting does not keep everything).
 */
export function recordError(entry) {
  let { kind="error", message="", stack="", label=null, hook=null, module=null } = entry;
  if ( !state.enabled || state.busy ) return null;
  if ( isBrowserNoise(message) ) return null;   // bruit connu du navigateur (ResizeObserver) : l'erreur de personne
  if ( !modulesReadable() ) {
    if ( early.length < 50 ) early.push({ ...entry });
    return null;
  }
  state.busy = true;     // an error during the survey (a listener) does not loop
  try {
    // The lines of the console wrapper (this file) blame no one: without them, every stack would cite the engine.
    stack = String(stack ?? "").split("\n").filter(l => !l.includes(SELF_FILE)).join("\n");
    const modules = packagesOfStack(stack);
    const owner = module ?? attribute(stack, { ignore: IGNORE }) ?? prefixed(message);
    // §467: a deprecation is the fault of the module that calls the old API (`owner`). If it is not the suite, a DAS module
    // lower in the stack (the button that launched the action) does not make it count as DAS — seen with Monk's Combat Details.
    const deprecation = isDeprecation(message);
    const suite = (deprecation && owner && !isSuitePackage(owner)) ? false
      : concernsSuite(owner ? [owner, ...modules] : modules, message);
    if ( !state.all && !suite ) return null;
    // Outside the suite (kept because "all modules" is ticked): put apart in the report, unticked by default.
    const { group, isNew } = errors.add({ kind, message, stack, label, hook, module: owner, modules, client: userId(),
      thirdParty: !suite, deprecation, trail: trailRing.last(10) });
    for ( const fn of listeners ) {
      try { fn(group, isNew); } catch { /* a faulty listener does not break the survey */ }
    }
    return group;
  } finally { state.busy = false; }
}

/** Called by the router when a registrant fails: the error with its label and its hook. */
export function noteRouterError(entry, err) {
  lastRouterError = err;
  recordError({ kind: entry.level === "warn" ? "warn" : "error", message: formatArgs([err]), stack: err?.stack ?? "",
    label: entry.label, hook: entry.hook, module: MODULE_ID });
}

/** Called by the router when a registrant cancels an operation: a trail gesture. */
export function noteRefused(entry) {
  trail("refused", `${entry.hook} ← ${entry.label}`);
}

/** The engine's texts (its language and the English fallback), read once the translations are loaded. */
let noticeTest = null;
function ownNotice(text) {
  if ( !noticeTest ) {
    const i18n = globalThis.game?.i18n;
    const prefix = "DND5ECOMBAT";
    const subtree = tree => tree?.[prefix] ?? Object.fromEntries(Object.entries(tree ?? {}).filter(([k]) => k.startsWith(`${prefix}.`)));
    const texts = [...translationTexts(subtree(i18n?.translations)), ...translationTexts(subtree(i18n?._fallback))];
    if ( !texts.length ) return false;   // before the translations load: nothing to recognize, we will retry
    noticeTest = noticeMatcher(texts);
  }
  return noticeTest(text);
}

/** A wrapped console line. */
function fromConsole(kind, args) {
  const err = errorIn(args);
  if ( err && (err === lastRouterError) ) { lastRouterError = null; return; }   // already collected by the router, with its label
  const here = err ? "" : (new Error().stack ?? "");
  // A notification from the interface ("out of range"…): Foundry repeats it in the console, it is not an error.
  if ( NOTIFICATION.test(here) ) return;
  let message = formatArgs(args);
  // Issue #238: an engine notice whose display another module replaced (the stack no longer goes through Notifications),
  // recognized by its text.
  if ( !err && ownNotice(message) ) return;
  let stack = err?.stack ?? here;
  // In a console group, the text is often in the group's label: PixiJS puts its deprecation warning there and
  // writes only the stack in `console.warn` (pixi.min.js, `deprecation`). The label goes first; a lone stack becomes the stack.
  const group = consoleGroups.at(-1);
  if ( group ) {
    if ( !err && isBareStack(message) ) {
      stack = message;
      message = group;
    }
    else message = `${group} — ${message}`;
  }
  recordError({ kind, message, stack });
}

/** An open console group: its label (`%c` styles removed), 20 levels at most. */
function openConsoleGroup(args) {
  consoleGroups.push(formatArgs(args));
  if ( consoleGroups.length > 20 ) consoleGroups.shift();
}

/** A closed console group. */
function closeConsoleGroup() {
  consoleGroups.pop();
}

/** In verbose mode, a console line from a suite module. */
function fromLog(args) {
  const message = formatArgs(args);
  const module = prefixed(message);
  if ( module ) logRing.push({ t: Date.now(), client: userId(), module, kind: "log", text: message });
}

/** A trail gesture. `text`: identifiers, never a name. */
export function trail(kind, text="", { module=MODULE_ID }={}) {
  if ( !state.enabled ) return null;
  return trailRing.push({ t: Date.now(), client: userId(), module, kind: String(kind), text: String(text).slice(0, 300) });
}

/* -------------------------------------------- */
/*  Installation                                */
/* -------------------------------------------- */

const onWindowError = event => recordError({ kind: "error", message: formatArgs([event.error ?? event.message]),
  stack: event.error?.stack ?? (event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : "") });
const onRejection = event => {
  const reason = event.reason;
  recordError({ kind: "rejection", message: formatArgs([reason]), stack: reason?.stack ?? "" });
};

/** Wraps the console and listens to global errors. No effect if already done. */
export function installCapture(target=globalThis) {
  if ( state.installed || !target.console ) return;
  const c = target.console;
  const original = { error: c.error, warn: c.warn, log: c.log, group: c.group, groupCollapsed: c.groupCollapsed, groupEnd: c.groupEnd };
  state.original = { target, ...original };
  for ( const name of ["group", "groupCollapsed"] ) {
    if ( typeof original[name] !== "function" ) continue;
    c[name] = function(...args) { original[name].apply(this, args); openConsoleGroup(args); };
  }
  if ( typeof original.groupEnd === "function" ) {
    c.groupEnd = function(...args) { original.groupEnd.apply(this, args); closeConsoleGroup(); };
  }
  c.error = function(...args) { original.error.apply(this, args); fromConsole("error", args); };
  c.warn = function(...args) { original.warn.apply(this, args); fromConsole("warn", args); };
  c.log = function(...args) { original.log.apply(this, args); if ( state.verbose ) fromLog(args); };
  target.addEventListener?.("error", onWindowError);
  target.addEventListener?.("unhandledrejection", onRejection);
  state.installed = true;
}

/**
 * Restores the original console. If another module wrapped the console after us (the connector), we do not touch it: our
 * wrappers stay but no longer collect anything (`enabled` false).
 */
export function uninstallCapture() {
  if ( !state.installed ) return;
  const { target, error, warn, log, group, groupCollapsed, groupEnd } = state.original;
  target.removeEventListener?.("error", onWindowError);
  target.removeEventListener?.("unhandledrejection", onRejection);
  const c = target.console;
  const ours = fn => ["fromConsole", "fromLog", "ConsoleGroup"].some(k => fn?.toString().includes(k));
  if ( ours(c.error) ) c.error = error;
  if ( ours(c.warn) ) c.warn = warn;
  if ( ours(c.log) ) c.log = log;
  if ( ours(c.group) ) c.group = group;
  if ( ours(c.groupCollapsed) ) c.groupCollapsed = groupCollapsed;
  if ( ours(c.groupEnd) ) c.groupEnd = groupEnd;
  consoleGroups.length = 0;
  state.installed = false;
}

/* -------------------------------------------- */
/*  Escalation to the active GM                 */
/* -------------------------------------------- */

/** On a client that is not the active GM: sends what is new. Keeps the send for later if there is no GM. */
export async function flush() {
  const gm = globalThis.game?.users?.activeGM;
  if ( gm?.isSelf ) return false;      // le MJ actif garde tout chez lui
  state.pending = state.pending.concat(errors.delta()).slice(-200);
  if ( !state.pending.length || !gm?.active ) return false;
  const items = state.pending;
  state.pending = [];
  try {
    await gm.query(DEBUG_QUERY, { userId: userId(), items }, { timeout: 10000 });
    return true;
  } catch {
    state.pending = items.concat(state.pending).slice(-200);
    return false;
  }
}

/** On the active GM: what another client collected. */
export function receive({ userId: from, items }={}, { user=null }={}) {
  if ( !Array.isArray(items) ) return false;
  // §472: the reporting client is the one that sends, not the one the data say.
  if ( user && !user.isSelf ) from = user.id;
  errors.merge(items.slice(0, 200), from ?? null);
  for ( const fn of listeners ) {
    try { fn(null, true); } catch { /* idem */ }
  }
  return true;
}

/** Verbose mode on this client. */
export function setVerbose(on) {
  state.verbose = !!on;
  trail("debug", `verbose ${state.verbose ? "on" : "off"}`);
  return state.verbose;
}

/** The GM: verbose mode on all connected clients (the others on receiving the request). */
export async function setVerboseEverywhere(on) {
  setVerbose(on);
  const users = (globalThis.game?.users ?? []).filter(u => u.active && !u.isSelf);
  await Promise.allSettled(users.map(u => u.query(DEBUG_VERBOSE_QUERY, { on: !!on }, { timeout: 5000 })));
  return users.length;
}

/* -------------------------------------------- */
/*  Trail: the engine's gestures                */
/* -------------------------------------------- */

function onUseActivity(activity, usage, results) {
  const item = activity?.item;
  const targets = globalThis.game?.user?.targets?.size ?? 0;
  trail("use", `${identifierOf(item)?.id || item?.type || "?"} · ${activity?.type ?? "?"}${targets ? ` · ${targets} target(s)` : ""}`
    + `${activity?.actor?.type ? ` · ${activity.actor.type}` : ""}`);
}

function onResolution(resolution, event) {
  const n = resolution?.targets?.length ?? 0;
  trail("resolution", [event?.type ?? event, resolution?.step, n ? `${n} target(s)` : null].filter(Boolean).join(" · "));
}

function onCombat(combat, changed) {
  if ( !("turn" in (changed ?? {})) && !("round" in (changed ?? {})) ) return;
  const actor = combat?.combatant?.actor;
  trail("turn", `round ${combat?.round ?? "?"} · turn ${combat?.turn ?? "?"}${actor?.type ? ` · ${actor.type}` : ""}`);
}

function onScene(canvas) {
  const s = canvas?.scene;
  const levels = s?.levels?.size ?? s?.levels?.length ?? 0;
  trail("scene", `grid ${s?.grid?.type ?? "?"} · ${s?.grid?.size ?? "?"} px · ${s?.grid?.distance ?? "?"} ${s?.grid?.units ?? ""}`
    + `${levels ? ` · ${levels} level(s)` : ""}`);
}

/* -------------------------------------------- */
/*  API                                         */
/* -------------------------------------------- */

export const debugApi = Object.freeze({
  /** A neighbor declares itself: `{ module, repo?, collect? }` — `collect()` returns an environment section (simple values). */
  register({ module, repo=null, collect=null }={}) {
    if ( typeof module !== "string" || !module ) return false;
    registered.set(module, { module, repo, collect: typeof collect === "function" ? collect : null });
    return true;
  },
  /** A neighbor's gesture in the trail: `trail(module, kind, text)`. */
  trail: (module, kind, text) => trail(kind, text, { module }),
  /**
   * The collected errors, grouped by signature, most recent first — on the active GM, including those the players send it.
   */
  errors: () => errors.list(),
  /** The number of collected errors: `total()` all; `total("suite")` the DAS errors; `total("others")` non-DAS. */
  total: which => errors.total(which),
  /** This client's trail: its last 50 DAS gestures (and the neighbors'), from oldest to most recent. */
  trailList: () => trailRing.list(),
  /** The console lines of the suite's modules kept in verbose mode (300 at most) on this client. */
  logs: () => logRing.list(),
  /** The neighbors declared through `register`: `[{ module, repo, collect }]`. */
  registered: () => Array.from(registered.values()),
  /**
   * With no argument: is this client's verbose mode on? With `on`: turns it on or off on this client, and returns the new state.
   */
  verbose: on => (on === undefined ? state.verbose : setVerbose(on)),
  verboseEverywhere: setVerboseEverywhere,
  /** Listen to new errors (the interface badge); returns a function to stop. */
  onError(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  /** Clears, on this client, the collected errors, the trail, the kept lines and what was waiting to be sent to the active GM. */
  clear() { errors.clear(); trailRing.clear(); logRing.clear(); state.pending = []; },
  /** Is the capture running on this client (client setting `debugCapture`)? */
  enabled: () => state.enabled
});

const internalSections = new Map();
/** A section of the engine itself in the report (§388: the last connection tests). Empty: absent. */
export function addReportSection(name, collect) {
  internalSections.set(name, collect);
}

/** The neighbors' sections, each read separately (a section that fails is noted, not fatal). */
export function collectSections() {
  const out = [];
  for ( const [module, collect] of internalSections ) {
    try { const data = collect(); if ( data && Object.keys(data).length ) out.push({ module, data }); }
    catch(err) { out.push({ module, data: { error: formatArgs([err]) } }); }
  }
  for ( const { module, collect } of registered.values() ) {
    if ( !collect ) continue;
    try { out.push({ module, data: collect() ?? {} }); }
    catch(err) { out.push({ module, data: { error: formatArgs([err]) } }); }
  }
  return out;
}

/** The known repositories: those of the registered neighbors, then the `url` of each suite module's module.json. */
export function knownRepos() {
  const out = {};
  for ( const mod of globalThis.game?.modules ?? [] ) if ( mod.active && isSuitePackage(mod.id) && mod.url ) out[mod.id] = mod.url;
  for ( const { module, repo } of registered.values() ) if ( repo ) out[module] = repo;
  return out;
}

/* -------------------------------------------- */
/*  Le rapport                                  */
/* -------------------------------------------- */

/** The users' roles, in English (the issues' language): "GM", "Player 1"… */
export function roles(labels={}) {
  const users = Array.from(globalThis.game?.users ?? [], u => ({ id: u.id, name: u.name, isGM: u.isGM, active: !!u.active }));
  return roleLabels(users, labels);
}

/**
 * The simple settings of the suite's modules that differ from their default value: booleans, numbers, and choice strings (never
 * free text or an object). Those left at default say nothing about the table and drowned the report (seen on a real report:
 * 190 lines).
 */
function suiteSettings() {
  const values = {};
  for ( const [id, s] of game.settings.settings ) {
    if ( !isSuitePackage(s.namespace) ) continue;
    const type = s.type?.name ?? typeof s.type;
    if ( !["Boolean", "Number", "String"].includes(type) || ((type === "String") && !s.choices) ) continue;
    let value;
    try { value = game.settings.get(s.namespace, s.key); } catch { continue; }
    if ( value !== s.default ) values[id] = value;
  }
  return safeSettings(values);
}

/** This client's environment: versions, active modules, suite settings, browser, scene. Nothing that names the table. */
export function environment() {
  const scene = globalThis.canvas?.scene;
  const levels = scene?.levels?.size ?? scene?.levels?.length ?? 0;
  const gm = game.users.activeGM;
  return {
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    language: game.i18n.lang,
    role: roles().get(game.user.id) ?? null,
    activeGM: gm ? (gm.isSelf ? "this client" : "connected") : "none",
    players: game.users.filter(u => u.active && !u.isGM).length,
    browser: globalThis.navigator?.userAgent ?? null,
    window: globalThis.innerWidth ? `${globalThis.innerWidth}×${globalThis.innerHeight}` : null,
    scene: scene ? `grid ${scene.grid?.type} · ${scene.grid?.size} px · ${scene.grid?.distance} ${scene.grid?.units ?? ""} · ${levels} level(s)`
      + ` · ${scene.tokens?.size ?? 0} token(s)` : null,
    combat: game.combat ? `round ${game.combat.round} · ${game.combat.combatants?.size ?? 0} combatant(s)` : null,
    modules: Array.from(game.modules).filter(m => m.active).map(m => ({ id: m.id, version: m.version ?? null }))
      .sort((a, b) => (isSuitePackage(b.id) - isSuitePackage(a.id)) || a.id.localeCompare(b.id)),
    settings: suiteSettings()
  };
}

/** What a token says of itself without naming itself: type, level, size, conditions, item identifiers, vertical position. */
export function tokenContext(token) {
  const doc = token?.document ?? token;
  const actor = doc?.actor;
  if ( !actor ) return null;
  const details = actor.system?.details ?? {};
  const ids = Array.from(actor.items ?? [], i => identifierOf(i)?.id || i.type).filter(Boolean);
  return {
    actorType: actor.type,
    actorLevel: details.level ?? (details.cr !== undefined ? `CR ${details.cr}` : null),
    size: actor.system?.traits?.size ?? null,
    hp: actor.system?.attributes?.hp ? `${actor.system.attributes.hp.value}/${actor.system.attributes.hp.max}` : null,
    statuses: Array.from(actor.statuses ?? []).join(", ") || null,
    disposition: doc.disposition ?? null,
    elevation: doc.elevation ?? null,
    tokenLevel: doc.level ?? null,
    inCombat: !!doc.inCombat,
    linked: !!doc.actorLink,
    items: `${ids.length}: ${ids.slice(0, 80).join(", ")}${ids.length > 80 ? ", …" : ""}`
  };
}

/** The names the report masks: users (→ roles), world title, and, unless asked, the world's and scene's actors. */
function scrubberFor({ includeNames=false }={}) {
  const names = [];
  const r = roles();
  for ( const u of game.users ) names.push([u.name, r.get(u.id) ?? "user"]);
  names.push([game.world?.title, "<world>"], [game.world?.id, "<world>"]);
  if ( !includeNames ) {
    for ( const a of game.actors ?? [] ) names.push([a.name, "<actor>"]);
    for ( const t of globalThis.canvas?.scene?.tokens ?? [] ) names.push([t.name, "<token>"]);
    names.push([globalThis.canvas?.scene?.name, "<scene>"]);
  }
  return createScrubber({ names });
}

/**
 * The full report, cleaned, and its Markdown. Clients (user ids) become roles.
 * @param {object} [options]
 * @param {string} [options.description]
 * @param {string[]} [options.selected]       Signatures of the retained errors (if absent: all, except those outside the suite).
 * @param {boolean} [options.includeNames]    Keep actor and token names.
 * @param {boolean} [options.includeFlagged]  Attach the flagged items (identifier and note).
 * @param {boolean} [options.includeLogs]     Attach the verbose-mode lines.
 * @param {Token|TokenDocument} [options.token]  A token's context (context menu).
 * @param {object} [options.labels]           Markdown titles.
 */
export function buildDebugReport({ description="", selected, includeNames=false, includeFlagged=false, includeLogs=false, token=null,
  labels={} }={}) {
  const r = roles();
  const who = id => (id ? (r.get(id) ?? "user") : null);
  const asRoles = step => ({ ...step, client: who(step.client) });
  const errorsNow = errors.list().map(g => ({ ...g, clients: g.clients.map(who), trail: g.trail.map(asRoles) }));
  const trailNow = trailRing.list().map(asRoles);
  if ( includeLogs ) trailNow.push(...logRing.list().map(asRoles));
  trailNow.sort((a, b) => a.t - b.t);
  const flagged = includeFlagged ? Object.values(itemReports() ?? {}).map(f => ({ identifier: f.identifier ?? "?", note: f.note ?? "" })) : [];
  const report = buildReport({ now: Date.now(), description, environment: environment(), context: tokenContext(token),
    errors: errorsNow, selected: selected ?? defaultSelection(), trail: trailNow, flagged, sections: collectSections() }, scrubberFor({ includeNames }));
  return { report, markdown: reportMarkdown(report, labels) };
}

/** The errors retained by default: the suite's (an entry outside the suite is ticked by hand). */
export function defaultSelection() {
  return errors.list().filter(g => !g.thirdParty).map(g => g.sig);
}

/** The GitHub repositories offered ("owner/repo"), the most implicated first. */
export function reportRepos(report) {
  const repos = Object.fromEntries(Object.entries(knownRepos()).map(([id, url]) => [id, githubRepo(url) ?? (/^[\w.-]+\/[\w.-]+$/.test(url) ? url : null)])
    .filter(([, repo]) => repo));
  const best = pickRepo(report?.errors ?? [], repos, repos[MODULE_ID] ?? null);
  const all = [...new Set([best, ...Object.values(repos)].filter(Boolean))];
  return all.map(repo => ({ repo, modules: Object.keys(repos).filter(id => repos[id] === repo) }));
}

/* -------------------------------------------- */
/*  Inscription                                 */
/* -------------------------------------------- */

/** At `init`, even on standby and at any automation level: settings, requests, trail, escalation. */
export function registerDebug() {
  game.settings.register(MODULE_ID, DEBUG_CAPTURE_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugCapture.Nom", hint: "DND5ECOMBAT.Reglage.debugCapture.Aide",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: value => applyCapture(value)
  });
  game.settings.register(MODULE_ID, DEBUG_ALL_SETTING, {
    name: "DND5ECOMBAT.Reglage.debugAllModules.Nom", hint: "DND5ECOMBAT.Reglage.debugAllModules.Aide",
    scope: "client", config: true, type: Boolean, default: false,
    onChange: value => setCaptureAll(value)
  });
  try {
    applyCapture(game.settings.get(MODULE_ID, DEBUG_CAPTURE_SETTING));
    setCaptureAll(game.settings.get(MODULE_ID, DEBUG_ALL_SETTING));
  } catch { /* unreadable settings: default values */ }
  replayEarly();

  CONFIG.queries[DEBUG_QUERY] = (data, options) => receive(data, options);
  // §472: only a GM turns on verbose mode on the others.
  CONFIG.queries[DEBUG_VERBOSE_QUERY] = ({ on }={}, { user=null }={}) => (fromTrusted(user) ? setVerbose(on) : state.verbose);

  const opts = label => ({ label: `debug: ${label}`, always: true });
  route("dnd5e.postUseActivity", onUseActivity, opts("use"));
  route(`${MODULE_ID}.resolution`, onResolution, opts("resolution"));
  route("updateCombat", onCombat, opts("turn"));
  route("canvasReady", onScene, opts("scene"));
  route("userConnected", (user, connected) => { if ( connected && user?.isGM ) flush(); }, opts("relay"));
  route("setup", () => Hooks.callAll(DEBUG_HOOK, debugApi), opts("neighbours"));
  route(DEBUG_PROBE_HOOK, ({ message="" }={}) => { throw new Error(`${PROBE_MARK}: ${message}`); }, { label: "debug: probe (deliberate failure)", always: true });
  route("ready", () => {
    if ( state.timer ) clearInterval(state.timer);
    state.timer = setInterval(() => { if ( state.enabled && !game.users.activeGM?.isSelf ) flush(); }, RELAY_MS);
  }, opts("relay"));
}

/** Also keep the errors of modules outside the suite (client setting `debugAllModules`). */
export function setCaptureAll(on) {
  state.all = !!on;
}

function applyCapture(on) {
  state.enabled = !!on;
  if ( state.enabled ) installCapture();
  else uninstallCapture();
}

// At script load: the capture runs before `init` (startup errors). The setting turns it off at `init`.
installCapture();
