/**
 * §380 (issue #36): the built-in debugger — the pure part. Group errors by signature, attribute an error to a module
 * by its stack, keep track of the last actions, scrub a report of what identifies the table (names, world, addresses),
 * write it as Markdown or JSON and derive from it the address of a pre-filled GitHub "New issue" page.
 * Nothing here reads Foundry: the clock, the names and the modules are given.
 */

export const MAX_MESSAGE = 1000;
export const MAX_FRAMES = 15;
export const MAX_GROUPS = 200;
export const TRAIL_SNAPSHOT = 10;

/* -------------------------------------------- */
/*  Piles d'appels                              */
/* -------------------------------------------- */

const FRAME_URL = /(?:https?|file):\/\/|\/(?:modules|systems)\//;
const PACKAGE = /\/(modules|systems)\/([^/?#\s]+)\//;

/** The lines of a stack that point to a file (Chrome "at f (url)" and Firefox "f@url" formats). */
export function stackFrames(stack) {
  if ( typeof stack !== "string" ) return [];
  return stack.split("\n").map(l => l.trim()).filter(l => l && FRAME_URL.test(l));
}

/** The package of a stack line: `{ type: "module" | "system", id }`, or null (Foundry core, browser). */
export function packageOfFrame(frame) {
  const m = PACKAGE.exec(frame ?? "");
  return m ? { type: m[1] === "systems" ? "system" : "module", id: m[2] } : null;
}

/** The packages cited by a stack, in order, without duplicates ("system:dnd5e" for a system). */
export function packagesOfStack(stack) {
  const out = [];
  for ( const frame of stackFrames(stack) ) {
    const p = packageOfFrame(frame);
    if ( !p ) continue;
    const key = p.type === "system" ? `system:${p.id}` : p.id;
    if ( !out.includes(key) ) out.push(key);
  }
  return out;
}

/**
 * The package at fault: the first of the stack that is not ignored (the debugger itself, lib-wrapper that only relays).
 * @param {string} stack
 * @param {object} [options]
 * @param {string[]} [options.ignore]  Packages or files to skip (`"lib-wrapper"`, `"dnd5e-combat/scripts/runtime/debug.mjs"`).
 */
export function attribute(stack, { ignore=[] }={}) {
  for ( const frame of stackFrames(stack) ) {
    if ( ignore.some(i => frame.includes(i.includes("/") ? i : `/${i}/`)) ) continue;
    const p = packageOfFrame(frame);
    if ( p ) return p.type === "system" ? `system:${p.id}` : p.id;
  }
  return null;
}

/* -------------------------------------------- */
/*  Avis de la suite (issue #238, §517)         */
/* -------------------------------------------- */

/** The text leaves of a translation tree (`{ A: { B: "texte" } }` or flat keys). */
export function translationTexts(tree, out=[]) {
  if ( typeof tree === "string" ) out.push(tree);
  else if ( tree && (typeof tree === "object") ) for ( const value of Object.values(tree) ) translationTexts(value, out);
  return out;
}

const stripTags = text => text.replace(/<[^>]*>/g, "");
/** A template that is too short or without words ("{name}", "Yes") would recognize anything: discarded. */
const MIN_LITERAL = 12;

/**
 * Issue #238: recognize a notice from the suite (a UI notification) that the console repeats. Foundry writes the text of a
 * notification to the console (Notifications#notify, `console: true`); if another module replaces the display of
 * notifications, the stack of that line no longer goes through `Notifications.*` and the notice looked like a warning from that
 * module. The suite's texts (its language files, tags removed, `{x}` = anything) recognize it whatever the stack.
 * @param {string[]} templates  The translated texts.
 * @returns {(text: string) => boolean}  Does the text contain one of these templates filled in? (Contains: a module that rewrites
 *   notifications may add its prefix to the console line.)
 */
export function noticeMatcher(templates) {
  const exact = new Set();
  const patterns = [];
  for ( const raw of new Set(templates.filter(t => typeof t === "string")) ) {
    const template = stripTags(raw).trim();
    const literal = template.replace(/\{[^{}]+\}/g, "").trim();
    if ( literal.length < MIN_LITERAL ) continue;
    if ( !/\{[^{}]+\}/.test(template) ) { exact.add(template); continue; }
    const source = template.split(/\{[^{}]+\}/).map(escapeRegExp).join("[\\s\\S]*?");
    try { patterns.push(new RegExp(source)); } catch { /* unreadable pattern: ignored */ }
  }
  return text => {
    const line = stripTags(String(text ?? "")).trim();
    if ( !line ) return false;
    if ( exact.has(line) ) return true;
    for ( const template of exact ) if ( line.includes(template) ) return true;
    return patterns.some(p => p.test(line));
  };
}

/* -------------------------------------------- */
/*  Messages                                    */
/* -------------------------------------------- */

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A console argument as text: an error as "Name: message", an object as truncated JSON. */
export function formatArg(arg) {
  if ( arg instanceof Error ) return `${arg.name}: ${arg.message}`;
  if ( (arg === null) || (arg === undefined) ) return String(arg);
  if ( typeof arg === "object" ) {
    try { return clip(JSON.stringify(arg), 300); }
    catch { return Object.prototype.toString.call(arg); }
  }
  return String(arg);
}

/**
 * The arguments of a console call as one message, cut at `MAX_MESSAGE`. A first string argument with console substitutions
 * (`%c` styles, `%s` `%d` `%i` `%f` `%o` `%O`) is filled in first: the styles disappear, the values take their place
 * (PixiJS writes "%cPixiJS Deprecation Warning: %c%s", styles, text).
 */
export function formatArgs(args) {
  const list = Array.from(args ?? []);
  const parts = [];
  if ( (typeof list[0] === "string") && /%[cdifoOs]/.test(list[0]) ) {
    let i = 1;
    parts.push(list[0].replace(/%([%cdifoOs])/g, (whole, k) => {
      if ( k === "%" ) return "%";
      if ( i >= list.length ) return whole;
      const value = list[i++];
      return k === "c" ? "" : formatArg(value);
    }));
    list.splice(0, i);
  }
  parts.push(...list.map(formatArg));
  return clip(parts.join(" ").trim(), MAX_MESSAGE);
}

/** A text that is only a call stack ("at …" or "f@url" lines, at most "Error" at the top): PixiJS writes it alone. */
export function isBareStack(text) {
  const lines = String(text ?? "").split("\n").map(l => l.trim()).filter(Boolean);
  if ( !lines.length ) return false;
  const body = /^Error\b/.test(lines[0]) ? lines.slice(1) : lines;
  return (body.length > 0) && body.every(l => /^at\s/.test(l) || /^[^\s@]*@\S+:\d+:\d+$/.test(l));
}

/** A deprecation warning (Foundry "Deprecated since Version", PixiJS "Deprecation Warning", "is deprecated"). */
export const isDeprecation = message => /\bdeprecat/i.test(String(message ?? ""));

/**
 * A known, harmless browser notice that is nobody's error: "ResizeObserver loop completed with undelivered
 * notifications" (or "…limit exceeded") is emitted when a layout resizes during its own observation.
 */
export const isBrowserNoise = message =>
  /^(?:Uncaught\s+)?(?:Error:\s*)?ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i
    .test(String(message ?? "").trim());

/** The first error among console arguments (for its stack), otherwise null. */
export function errorIn(args) {
  return Array.from(args ?? []).find(a => a instanceof Error) ?? null;
}

/** 32-bit FNV-1a hash in hexadecimal: short, stable, dependency-free. */
export function hash(text) {
  let h = 0x811c9dc5;
  for ( let i = 0; i < text.length; i++ ) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The signature of an error: its message without what varies from one time to the next (Foundry ids, numbers) and its first
 * stack line without the server address or the column. Two errors with the same signature are "the same" and are counted.
 */
export function signature({ kind="error", message="", stack="" }={}) {
  const text = String(message).replace(/\b[a-zA-Z0-9]{16}\b/g, "<id>").replace(/\d+(\.\d+)?/g, "#");
  const frame = (stackFrames(stack)[0] ?? "").replace(/(?:https?|file):\/\/[^/\s)]+/g, "").replace(/\?[^:\s)]*/g, "")
    .replace(/:(\d+):\d+(\)?)$/, ":$1$2");
  return hash(`${kind}|${text}|${frame}`);
}

/* -------------------------------------------- */
/*  Anneau et regroupement                      */
/* -------------------------------------------- */

/** A bounded ring: the last `limit` elements. */
export function createRing(limit=50) {
  let items = [];
  return {
    push(item) {
      items.push(item);
      if ( items.length > limit ) items.splice(0, items.length - limit);
      return item;
    },
    list() { return items.slice(); },
    last(n) { return n > 0 ? items.slice(-n) : []; },
    clear() { items = []; },
    get size() { return items.length; }
  };
}

/**
 * The error log, grouped by signature. A player client derives a "delta" from it (the groups that are new or that have counted
 * since the last send) for the active GM, who merges it into their own.
 * @param {object} [options]
 * @param {number} [options.limit]  Groups kept at most; beyond that, the least recent go.
 * @param {() => number} [options.now]
 */
export function createErrorLog({ limit=MAX_GROUPS, now=() => Date.now() }={}) {
  let groups = new Map();
  let sent = new Map();       // signature → count already sent

  const trim = () => {
    if ( groups.size <= limit ) return;
    const oldest = Array.from(groups.values()).sort((a, b) => a.last - b.last).slice(0, groups.size - limit);
    for ( const g of oldest ) { groups.delete(g.sig); sent.delete(g.sig); }
  };

  const addClient = (group, client) => {
    if ( client && !group.clients.includes(client) ) group.clients.push(client);
  };

  return {
    /**
     * A recorded error. `entry`: `{ kind, message, stack, module, modules, label, hook, client, trail }`.
     * @returns {{ group: object, isNew: boolean }}
     */
    add(entry) {
      const message = clip(String(entry.message ?? ""), MAX_MESSAGE);
      const kind = entry.kind ?? "error";
      const sig = entry.sig ?? signature({ kind, message, stack: entry.stack });
      const t = now();
      let group = groups.get(sig);
      const isNew = !group;
      if ( isNew ) {
        group = { sig, kind, message, stack: stackFrames(entry.stack).slice(0, MAX_FRAMES), module: entry.module ?? null,
          modules: entry.modules ?? packagesOfStack(entry.stack), label: entry.label ?? null, hook: entry.hook ?? null,
          thirdParty: !!entry.thirdParty, deprecation: !!entry.deprecation, count: 0, first: t, last: t, clients: [], trail: (entry.trail ?? []).slice(-TRAIL_SNAPSHOT) };
        groups.set(sig, group);
      }
      group.count += Math.max(1, entry.count ?? 1);
      group.last = t;
      addClient(group, entry.client);
      if ( isNew ) trim();
      return { group, isNew };
    },

    /** The groups that are new or that have counted since the last call, with `added` (the number of extra times). */
    delta() {
      const out = [];
      for ( const g of groups.values() ) {
        const added = g.count - (sent.get(g.sig) ?? 0);
        if ( added <= 0 ) continue;
        out.push({ ...g, stack: g.stack.slice(), clients: g.clients.slice(), trail: g.trail.slice(), added });
        sent.set(g.sig, g.count);
      }
      return out;
    },

    /** A delta from another client (GM side): each group counts `added` times more, and cites that client. */
    merge(items, client) {
      for ( const item of items ?? [] ) {
        const known = groups.get(item.sig);
        if ( known ) {
          known.count += Math.max(1, item.added ?? 1);
          known.last = now();
          addClient(known, client);
          continue;
        }
        groups.set(item.sig, { sig: item.sig, kind: item.kind ?? "error", message: clip(String(item.message ?? ""), MAX_MESSAGE),
          stack: (item.stack ?? []).slice(0, MAX_FRAMES), module: item.module ?? null, modules: item.modules ?? [],
          label: item.label ?? null, hook: item.hook ?? null, thirdParty: !!item.thirdParty, deprecation: !!item.deprecation,
          count: Math.max(1, item.added ?? 1), first: now(), last: now(),
          clients: client ? [client] : [], trail: (item.trail ?? []).slice(-TRAIL_SNAPSHOT) });
        trim();
      }
    },

    /** The groups, most recent first. */
    list() { return Array.from(groups.values()).sort((a, b) => b.last - a.last); },
    get(sig) { return groups.get(sig) ?? null; },
    /**
     * The number of recorded errors (repetitions included). `which`: "suite" (DAS errors only), "others" (non-DAS,
     * kept by "all modules"), absent: all.
     */
    total(which) {
      const keep = which === "suite" ? g => !g.thirdParty : which === "others" ? g => !!g.thirdParty : () => true;
      return Array.from(groups.values()).filter(keep).reduce((n, g) => n + g.count, 0);
    },
    clear() { groups = new Map(); sent = new Map(); },
    get size() { return groups.size; }
  };
}

/* -------------------------------------------- */
/*  Privacy                                     */
/* -------------------------------------------- */

export const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A name is masked as a whole word: not stuck to a letter, a digit, a hyphen, an underscore or a slash (a module
 * id, "darsh-loot", "foundry-connecteur-claude", a path), nor preceded by a dot or followed by a dot and a letter (a
 * file name). "Zoé." at the end of a sentence is still a name.
 */
export const WORD_BEFORE = "(?<![\\p{L}\\p{N}_./-])";
export const WORD_AFTER = "(?![\\p{L}\\p{N}_/-]|\\.\\w)";

/**
 * Users as roles: the GM "GM" ("GM 2" if there are several), the players "Player 1", "Player 2"… in the given
 * order. The labels are supplied (interface language).
 * @param {{ id: string, name: string, isGM: boolean }[]} users
 * @returns {Map<string, string>} id → label
 */
export function roleLabels(users, { gm="GM", player="Player" }={}) {
  const out = new Map();
  let gms = 0;
  let players = 0;
  // Numbered only if several GMs are connected (`active`, true by default): a test GM account left offline does not make
  // the game's only GM a "GM 1".
  const gmCount = users.filter(u => u.isGM && (u.active ?? true)).length;
  for ( const u of users ) {
    if ( u.isGM ) out.set(u.id, (gmCount > 1) ? `${gm} ${++gms}` : gm);
    else out.set(u.id, `${player} ${++players}`);
  }
  return out;
}

/**
 * A text scrubber: the given names (users, world title, actor names when not wanted) replaced by
 * their label, addresses reduced to their path (a Forge game's host names the game), without query parameters, the
 * Forge account folder masked, visible keys and tokens erased.
 * @param {object} [options]
 * @param {Array<[string, string]>} [options.names]  Pairs [text to mask, replacement]. Texts under 3 letters are ignored.
 */
export function createScrubber({ names=[] }={}) {
  const pairs = names.filter(([text]) => (typeof text === "string") && (text.trim().length >= 3))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([text, by]) => [new RegExp(`${WORD_BEFORE}${escapeRegExp(text.trim())}${WORD_AFTER}`, "giu"), by]);
  return text => {
    if ( typeof text !== "string" ) return text;
    let out = text
      .replace(/assets\.forge-vtt\.com\/[^/\s"')]+\//g, "assets.forge-vtt.com/<account>/")
      .replace(/(?:https?|wss?):\/\/(?!assets\.forge-vtt\.com)[^/\s"')]+/g, "")
      .replace(/(\.[a-z0-9]{1,5})\?[^\s"'):]*/gi, "$1")
      .replace(/\b(api[-_]?key|token|password|secret|session)(["']?\s*[:=]\s*["']?)[^\s"',;&)]+/gi, "$1$2<hidden>");
    for ( const [re, by] of pairs ) out = out.replace(re, by);
    return out;
  };
}

/** Scrubs all strings of a value (objects and arrays walked), without touching keys. */
export function scrubDeep(value, scrub) {
  if ( typeof value === "string" ) return scrub(value);
  if ( Array.isArray(value) ) return value.map(v => scrubDeep(v, scrub));
  if ( value && (typeof value === "object") ) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, scrub)]));
  }
  return value;
}

/**
 * The settings a report may show: booleans, finite numbers and short strings without spaces (a choice: "full", "2024").
 * Objects, lists and free text (notes, factions, flags) never go there.
 * @param {Record<string, unknown>} values
 * @param {object} [options]
 * @param {string[]} [options.exclude]  Keys never to show, even simple ones.
 */
export function safeSettings(values, { exclude=[] }={}) {
  const out = {};
  for ( const [key, v] of Object.entries(values ?? {}) ) {
    if ( exclude.includes(key) ) continue;
    if ( (typeof v === "boolean") || ((typeof v === "number") && Number.isFinite(v)) ) out[key] = v;
    else if ( (typeof v === "string") && (v.length <= 40) && !/\s/.test(v) ) out[key] = v;
  }
  return out;
}

/* -------------------------------------------- */
/*  Le rapport                                  */
/* -------------------------------------------- */

export const REPORT_SCHEMA = 1;

/**
 * The report, scrubbed. The errors kept are those whose signature is in `selected` (all if absent).
 * @param {object} input
 * @param {string} [input.description]
 * @param {object} [input.environment]   Versions, modules, settings, client, scene (already simple).
 * @param {object[]} [input.errors]      Groups of the log.
 * @param {string[]} [input.selected]    Selected signatures.
 * @param {object[]} [input.trail]       The latest actions.
 * @param {object[]} [input.flagged]     Flagged items `{ identifier, note }`.
 * @param {object[]} [input.sections]    Sections from neighboring modules `{ module, data }`.
 * @param {object} [input.context]       The context of a token (context menu).
 * @param {number} input.now
 * @param {(text: string) => string} [scrub]
 */
export function buildReport(input, scrub=t => t) {
  const now = input.now;
  const selected = input.selected ? new Set(input.selected) : null;
  const ago = t => (Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 100) / 10) : null);
  const step = s => ({ ago: ago(s.t), client: s.client ?? null, module: s.module ?? null, kind: s.kind, text: s.text ?? "" });
  const errors = (input.errors ?? []).filter(g => !selected || selected.has(g.sig)).map(g => ({
    sig: g.sig, kind: g.kind, module: g.module, modules: g.modules ?? [], label: g.label, hook: g.hook, message: g.message,
    thirdParty: !!g.thirdParty, deprecation: !!g.deprecation, count: g.count, firstAgo: ago(g.first), lastAgo: ago(g.last), clients: g.clients ?? [], stack: g.stack ?? [],
    trail: (g.trail ?? []).map(step)
  }));
  const report = {
    schema: REPORT_SCHEMA,
    generated: new Date(now).toISOString(),
    description: input.description ?? "",
    environment: input.environment ?? {},
    context: input.context ?? null,
    errors,
    trail: (input.trail ?? []).map(step),
    flagged: input.flagged ?? [],
    sections: input.sections ?? []
  };
  return scrubDeep(report, scrub);
}

const fence = text => String(text).replace(/```/g, "ˋˋˋ");
const line = text => fence(String(text ?? "")).replace(/\s*\n\s*/g, " ");

export const MARKDOWN_LABELS = {
  description: "Description", noDescription: "(none)", environment: "Environment", context: "Token context", errors: "Errors",
  noErrors: "No error recorded.", trail: "Recent DAS actions", flagged: "Flagged items", sections: "Modules",
  times: "×", clients: "clients", hook: "hook", lastSeen: "last", ago: "ago", before: "Before this error",
  settings: "DAS settings changed from their default", others: "Other modules (not DAS)",
  othersHint: "Raised by modules outside the suite; kept because « all modules » is ticked in the DAS debugger.",
  deprecation: "deprecation"
};

/** A readable elapsed duration: "12 s", "47 min", "2 h 05". */
export function formatAgo(seconds) {
  if ( !Number.isFinite(seconds) ) return "?";
  const s = Math.max(0, Math.round(seconds));
  if ( s < 60 ) return `${s} s`;
  if ( s < 3600 ) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/**
 * The title of an error: the first line of its message, without the "Error:" that the type already says, cut at a word under `max`.
 * @returns {{ title: string, whole: boolean }}  `whole`: the title says the whole message (no need to repeat it in a block).
 */
export function errorTitle(message, max=120) {
  const text = String(message ?? "").trim();
  const first = text.split("\n")[0].replace(/^(?:Uncaught\s+)?Error:\s*/, "").trim();
  let title = first;
  if ( title.length > max ) {
    const cut = title.lastIndexOf(" ", max - 1);
    title = `${title.slice(0, cut > max / 2 ? cut : max - 1).trimEnd()}…`;
  }
  return { title, whole: (title === first) && !text.includes("\n") };
}

const value = v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

/** A "- key: value" list of a flat or nearly flat object (sub-objects as compact JSON). */
function bullets(obj, indent="") {
  return Object.entries(obj ?? {}).filter(([, v]) => (v !== undefined) && (v !== null) && (v !== ""))
    .map(([k, v]) => `${indent}- **${k}**: ${line(value(v))}`);
}

const stepLine = (s, L) => `- ${formatAgo(s.ago)} ${L.ago} · ${[s.client, s.module, s.kind].filter(Boolean).join(" · ")} — ${line(s.text)}`;

/** The report as Markdown (GitHub, Discord). The headings are given; English by default, the language of issues. */
export function reportMarkdown(report, labels={}) {
  const L = { ...MARKDOWN_LABELS, ...labels };
  const out = [];
  out.push(`## ${L.description}`, "", report.description?.trim() ? fence(report.description.trim()) : L.noDescription, "");
  const env = report.environment ?? {};
  out.push(`## ${L.environment}`, "");
  const { modules, settings, ...rest } = env;
  out.push(...bullets(rest));
  if ( modules?.length ) out.push(`- **modules** (${modules.length}): ${modules.map(m => `${m.id} ${m.version ?? ""}`.trim()).join(", ")}`);
  if ( settings && Object.keys(settings).length ) {
    out.push("", `<details><summary>${L.settings} (${Object.keys(settings).length})</summary>`, "", ...bullets(settings), "", "</details>");
  }
  out.push("");
  if ( report.context ) out.push(`## ${L.context}`, "", ...bullets(report.context), "");
  const ours = report.errors.filter(e => !e.thirdParty);
  const others = report.errors.filter(e => e.thirdParty);
  out.push(`## ${L.errors}`, "");
  if ( !ours.length ) out.push(L.noErrors, "");
  for ( const e of ours ) out.push(...errorMarkdown(e, L));
  if ( others.length ) {
    out.push(`## ${L.others}`, "", L.othersHint, "", `<details><summary>${L.others} (${others.length})</summary>`, "");
    for ( const e of others ) out.push(...errorMarkdown(e, L));
    out.push("</details>", "");
  }
  if ( report.trail.length ) out.push(`## ${L.trail}`, "", ...report.trail.map(s => stepLine(s, L)), "");
  if ( report.flagged.length ) out.push(`## ${L.flagged}`, "", ...report.flagged.map(f => `- \`${line(f.identifier)}\`${f.note ? ` — ${line(f.note)}` : ""}`), "");
  if ( report.sections.length ) {
    out.push(`## ${L.sections}`, "");
    for ( const s of report.sections ) out.push(`### ${line(s.module)}`, "", ...bullets(s.data), "");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** An error of the report as Markdown lines: title, context, whole message if long, stack, preceding actions. */
function errorMarkdown(e, L) {
  const out = [];
  const head = [e.module ? `[${e.module}]` : null, e.kind, e.deprecation ? L.deprecation : null, `${L.times}${e.count}`]
    .filter(Boolean).join(" ");
  const { title, whole } = errorTitle(e.message);
  out.push(`### ${head} — ${line(title)}`, "");
  const meta = [e.label ? line(e.label) : null, e.hook ? `${L.hook} \`${line(e.hook)}\`` : null,
    e.clients.length ? `${L.clients}: ${e.clients.join(", ")}` : null,
    Number.isFinite(e.lastAgo) ? `${L.lastSeen} ${formatAgo(e.lastAgo)} ${L.ago}` : null].filter(Boolean);
  if ( meta.length ) out.push(meta.join(" · "), "");
  if ( !whole ) out.push("```", fence(e.message), "```", "");
  if ( e.stack.length ) out.push("```", ...e.stack.map(fence), "```", "");
  if ( e.trail.length ) out.push(`<details><summary>${L.before}</summary>`, "", ...e.trail.map(s => stepLine(s, L)), "", "</details>", "");
  return out;
}

/** The report as readable JSON (the file to attach). */
export function reportJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/* -------------------------------------------- */
/*  GitHub                                      */
/* -------------------------------------------- */

/** "owner/repo" of a GitHub address (`url` of a module.json, with or without `.git`), otherwise null. */
export function githubRepo(url) {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(String(url ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The repository to suggest: that of the most implicated module (errors × repetitions) that has a GitHub repository, otherwise
 * `fallback`.
 * @param {object[]} errors
 * @param {Record<string, string>} repos  Module → "owner/repo".
 */
export function pickRepo(errors, repos, fallback=null) {
  const score = new Map();
  for ( const e of errors ?? [] ) {
    if ( e.module && repos[e.module] ) score.set(e.module, (score.get(e.module) ?? 0) + (e.count ?? 1));
  }
  const best = Array.from(score.entries()).sort((a, b) => b[1] - a[1])[0];
  return best ? repos[best[0]] : fallback;
}

/** Cuts a text at a line end so that its address encoding fits in `budget`, closes an open code block, adds `note`. */
export function truncateForUrl(text, budget, note="") {
  if ( encodeURIComponent(text).length <= budget ) return text;
  const tail = note ? `\n\n${note}\n` : "\n";
  let cut = text.length;
  let body = text;
  while ( cut > 0 ) {
    cut = Math.floor(cut * 0.9);
    const nl = text.lastIndexOf("\n", cut);
    body = text.slice(0, nl > 0 ? nl : cut);
    if ( ((body.match(/^```/gm) ?? []).length % 2) === 1 ) body += "\n```";
    if ( encodeURIComponent(body + tail).length <= budget ) break;
  }
  return `${body}${tail}`;
}

/**
 * The address of the pre-filled "New issue" page of a repository. The body is cut so that the address stays under `max`
 * characters (GitHub rejects addresses that are too long); `note` then says to attach the full file.
 */
export function issueUrl({ repo, title="", body="", max=7000, note="" }) {
  if ( !repo ) return null;
  const base = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=`;
  return base + encodeURIComponent(truncateForUrl(body, Math.max(200, max - base.length), note));
}
