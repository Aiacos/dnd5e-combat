/**
 * §388: a player's connection and compatibility test, live — the measurements, on each client.
 *  - The GM sends the player's client ten "ping" requests (`CONNECTION_PING_QUERY`) one after another: round-trip time
 *    GM → server → player → server → GM, and the player's clock (clock skew).
 *  - Then a "probe" request (`CONNECTION_PROBE_QUERY`): the player's client describes what it has loaded and what it is
 *    experiencing — versions, fingerprint of each suite module's code (browser cache), language, right to browse files (Babele),
 *    character, hidden window, blocked sound, Dice So Nice, graphics card (Foundry's support report), frames per second measured
 *    over 2 s, scene seen, DAS errors collected, DAS settings of this computer that differ from the default.
 *  - The GM compares with their own client (`core/connection.mjs`) and keeps the last result per player (attached to the
 *    bug report).
 * Nothing is written to the world; names do not leave (roles « Player 1 »…).
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";
import { apiShape, browserFamily, browserName, diagnose, fingerprint, pingStats } from "../core/connection.mjs";
import { safeSettings } from "../core/debug.mjs";
import { addReportSection, debugApi, isSuitePackage, roles } from "./debug.mjs";
import { describeRoutes } from "./router.mjs";

export const CONNECTION_PING_QUERY = `${MODULE_ID}.connectionPing`;
export const CONNECTION_PROBE_QUERY = `${MODULE_ID}.connectionProbe`;
export const CONNECTION_CONSENT_QUERY = `${MODULE_ID}.connectionConsent`;
/** World setting (Advanced tab): the test exists. Off by default; off, the clients refuse its requests. */
export const CONNECTION_SETTING = "connectionTest";
/** The time the player has to answer, and how long their consent lasts (the whole test fits within it). */
export const CONSENT_MS = 60000;
export const CONSENT_VALID_MS = 120000;
export const PING_COUNT = 10;
export const FPS_MS = 2000;

const results = new Map();   // userId → last result
const consent = { until: 0, prompt: null, pending: null, by: null };

/** Is the test allowed in this world? */
export function connectionTestEnabled() {
  try { return !!game.settings.get(MODULE_ID, CONNECTION_SETTING); } catch { return false; }
}

/** The interface provides the consent window (ui/connection-test.mjs): `async ({ gm }) => "allowed" | "refused" | "timeout"`. */
export function setConsentPrompt(fn) {
  consent.prompt = typeof fn === "function" ? fn : null;
}

/** Player side: ask for their consent (one window at a time). Once granted, measurements are allowed during `CONSENT_VALID_MS`. */
async function askConsent({ gm=null }={}, { user=null }={}) {
  if ( !connectionTestEnabled() ) return { answer: "disabled" };
  // §472: only a GM asks for consent, under their real name; the consent only holds for them.
  if ( !fromTrusted(user) ) return { answer: "refused" };
  if ( user && !user.isSelf ) gm = user.name;
  if ( !consent.prompt ) return { answer: "refused" };
  consent.pending ??= Promise.resolve(consent.prompt({ gm })).catch(() => "refused").finally(() => { consent.pending = null; });
  const answer = await consent.pending;
  if ( answer === "allowed" ) { consent.until = Date.now() + CONSENT_VALID_MS; consent.by = user?.id ?? null; }
  return { answer };
}

/** The measurements only go out during an ongoing consent (a request sent without going through the window is refused). */
function requireConsent(user=null) {
  if ( !connectionTestEnabled() || (Date.now() > consent.until) ) throw new Error("connection test not allowed by this player");
  if ( user && !user.isSelf && (consent.by !== user.id) ) throw new Error("connection test allowed to another user");
}

/** The fingerprint of a suite module's loaded code: for the engine, its router registrations and its queries; for a neighbour,
 *  the shape of its public API. Independent of language. */
export function codeFingerprint(id) {
  if ( id === MODULE_ID ) {
    const routes = Object.entries(describeRoutes()).flatMap(([hook, list]) => list.map(r => `${hook}:${r.label}`));
    const queries = Object.keys(globalThis.CONFIG?.queries ?? {}).filter(k => k.startsWith(`${MODULE_ID}.`));
    return fingerprint([...routes, ...queries]);
  }
  return fingerprint(apiShape(game.modules.get(id)?.api));
}

/** The suite modules active on this client, with their version and their code fingerprint. */
function suiteModules() {
  return Array.from(game.modules).filter(m => m.active && isSuitePackage(m.id))
    .map(m => ({ id: m.id, version: m.version ?? null, code: codeFingerprint(m.id) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** What the GM's client serves as the reference. */
export function referenceClient() {
  return {
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    language: game.i18n.lang,
    modules: suiteModules(),
    activeModules: Array.from(game.modules).filter(m => m.active).map(m => m.id).sort(),
    viewedScene: game.user.viewedScene ?? null
  };
}

/** This computer's DAS settings (client scope) that differ from their default value, simple ones only. */
function clientSettings() {
  const values = {};
  for ( const [id, s] of game.settings.settings ) {
    if ( (s.scope !== "client") || !isSuitePackage(s.namespace) ) continue;
    const type = s.type?.name ?? typeof s.type;
    if ( !["Boolean", "Number", "String"].includes(type) || ((type === "String") && !s.choices) ) continue;
    let value;
    try { value = game.settings.get(s.namespace, s.key); } catch { continue; }
    if ( value !== s.default ) values[id] = value;
  }
  return safeSettings(values);
}

/** The canvas's frames per second, averaged over `ms`. Hidden window or no canvas: `null`. */
async function measureFps(ms=FPS_MS) {
  const ticker = globalThis.canvas?.app?.ticker;
  if ( !ticker || document.hidden ) return null;
  let frames = 0;
  const count = () => { frames++; };
  ticker.add(count);
  const t0 = performance.now();
  await new Promise(r => setTimeout(r, ms));
  ticker.remove(count);
  return Math.round(frames * 1000 / (performance.now() - t0));
}

/** Foundry's support report (system, browser, graphics card), if it can be read. */
async function supportReport() {
  try { return await foundry.applications.sidebar.apps.SupportDetails.generateSupportReport(); }
  catch { return {}; }
}

function webgl2() {
  try { return !!document.createElement("canvas").getContext("webgl2"); }
  catch { return null; }
}

function setting(ns, key) {
  try { return game.settings.get(ns, key); } catch { return undefined; }
}

/** The number of translation files the GM published for Babele (`null`: Babele absent). */
function babelePublished() {
  if ( !game.modules.get("babele")?.active ) return null;
  const files = setting("babele", "translationFiles");
  return Array.isArray(files) ? files.length : null;
}

/** The probe: this client describes itself. `fps: false`: without the 2 s measurement. */
export async function probeClient({ fps=true }={}) {
  const support = await supportReport();
  const character = game.user.character;
  const dsn = game.modules.get("dice-so-nice");
  let audioLocked = null;
  try { audioLocked = game.audio?.locked ?? null; } catch { /* absent */ }
  return {
    ...referenceClient(),
    now: Date.now(),
    client: browserName(navigator.userAgentData?.fullVersionList ?? navigator.userAgentData?.brands, navigator.userAgent),
    browserFamily: browserFamily(navigator.userAgent),
    os: support.os ?? null,
    gpu: support.gpu ?? null,
    maxTextureSize: Number.isFinite(support.maxTextureSize) ? support.maxTextureSize : null,
    webgl2: webgl2(),
    performanceMode: support.performanceMode ?? null,
    screen: support.screen ?? `${screen.width} × ${screen.height}`,
    viewport: support.viewport ?? `${innerWidth} × ${innerHeight}`,
    dpr: globalThis.devicePixelRatio ?? null,
    memory: navigator.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    canvas: !setting("core", "noCanvas") && !!globalThis.canvas?.ready,
    fps: fps ? await measureFps() : null,
    hidden: !!document.hidden,
    focused: document.hasFocus?.() ?? null,
    audioLocked,
    diceSoNice: !!dsn?.active && (setting("dice-so-nice", "enabled") !== false),
    babele: !!game.modules.get("babele")?.active,
    babeleBrowses: game.user.isGM && game.user.can("FILES_BROWSE"),
    babelePublished: babelePublished(),
    character: !character ? "none" : character.isOwner ? "owned" : "notOwned",
    errors: debugApi.total(),
    settings: clientSettings()
  };
}

/**
 * The test, on the GM's side: round trips then probe, compared with their own client.
 * @param {User|string} target
 * @param {object} [options]
 * @param {number} [options.count]     Number of round trips.
 * @param {(step: string) => void} [options.progress]
 */
export async function testConnection(target, { count=PING_COUNT, progress=() => {} }={}) {
  const user = (typeof target === "string") ? game.users.get(target) : target;
  if ( !user?.active ) throw new Error("user not connected");
  const base = { userId: user.id, role: roles().get(user.id) ?? "user", at: Date.now() };
  progress("consent");
  let answer;
  try { answer = (await user.query(CONNECTION_CONSENT_QUERY, { gm: game.user.name }, { timeout: CONSENT_MS + 10000 }))?.answer; }
  catch { answer = "noAnswer"; }
  if ( answer !== "allowed" ) {
    const id = { refused: "refused", timeout: "consentTimeout", disabled: "disabled" }[answer] ?? "noConsent";
    const result = { ...base, pings: null, probe: null, reference: null,
      findings: [{ id, level: (id === "refused") ? "info" : "warn", data: {} }] };
    results.set(user.id, result);
    return result;
  }
  const samples = [];
  for ( let i = 0; i < count; i++ ) {
    progress("ping", i + 1, count);
    const sent = Date.now();
    try {
      const answer = await user.query(CONNECTION_PING_QUERY, {}, { timeout: 5000 });
      samples.push({ sent, received: Date.now(), remote: answer?.now });
    } catch { samples.push({ lost: true }); }
  }
  const pings = pingStats(samples);
  progress("probe");
  let probe = null;
  try { probe = await user.query(CONNECTION_PROBE_QUERY, {}, { timeout: 20000 }); } catch { /* no response */ }
  const reference = referenceClient();
  // The errors this player has already reported to the active GM (§380), if their own probe did not answer.
  if ( probe && !probe.errors ) probe.errors = debugApi.errors().filter(g => g.clients.includes(user.id)).reduce((n, g) => n + g.count, 0);
  const result = {
    ...base,
    pings, probe, reference,
    findings: diagnose({ pings, probe, reference })
  };
  results.set(user.id, result);
  return result;
}

/** The latest results, one line per tested player (for the bug report): role → round trip and non-"ok" findings. */
export function lastConnectionTests() {
  const out = {};
  for ( const r of results.values() ) {
    const ping = Number.isFinite(r.pings?.median) ? `ping ${r.pings.median} ms (worst ${r.pings.worst})` : "no answer";
    const issues = r.findings.filter(f => f.level !== "ok").map(f => `${f.level} ${f.id}`);
    out[r.role] = [ping, ...issues].join(" · ");
  }
  return out;
}

/** At `init`, even when dormant: the setting and the three queries a client answers (consent, then measurements under consent). */
export function registerConnection() {
  game.settings.register(MODULE_ID, CONNECTION_SETTING, {
    name: "DND5ECOMBAT.Reglage.connectionTest.Nom", hint: "DND5ECOMBAT.Reglage.connectionTest.Aide",
    scope: "world", config: true, type: Boolean, default: false
  });
  CONFIG.queries[CONNECTION_CONSENT_QUERY] = (data, options) => askConsent(data, options);
  CONFIG.queries[CONNECTION_PING_QUERY] = (data, { user=null }={}) => { requireConsent(user); return { now: Date.now() }; };
  CONFIG.queries[CONNECTION_PROBE_QUERY] = (data, { user=null }={}) => { requireConsent(user); return probeClient(); };
  addReportSection("connection tests", lastConnectionTests);
}
