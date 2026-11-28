/**
 * DAS test base — TRANSLATIONS. File COPIED as is from the engine repository (`tools/contract/das-i18n.test.mjs`):
 * do not modify it here. In the engine, `node tools/contract/sync.mjs` copies it again into all modules; what is specific
 * to a module goes in `tests/das-tests.json`, section `"i18n"` (without it, the survey of the code's keys is skipped).
 *
 * The suite's rule: `en` is Foundry's fallback language, `fr` has all its keys; another language (`pt-BR`, translated
 * by a contributor) may lag behind, but never has an extra key, an empty value or other `{variables}`.
 * Checks:
 *   1. each file of `module/lang/` is valid JSON and listed in `module.json` (`languages`), `en` and `fr` included;
 *   2. each value is a non-empty text;
 *   3. `fr` has all the keys of `en`; no language has a key absent from `en`, nor other `{variables}` than `en`;
 *   4. no key is the prefix of another ("A.B" and "A.B.C": Foundry stores keys as a tree, one overwrites the other);
 *   5. each key written literally in the code exists in `en` (so in `fr`), and each start of a built key
 *      (`` `DLO.Tables.${…}` ``) starts at least one key of `en`;
 *   6. the code's `LOCALIZATION_PREFIXES`, the compendium labels and the document types declared by
 *      `module.json` (`TYPES.RegionBehavior.<id>.<type>`) have their translations.
 *
 * Setting, `tests/das-tests.json`:
 *   "i18n": {
 *     "namespaces": ["DLO"],                       // first segments of the module's keys: "DLO.Window.Title" is a key
 *     "sources": ["module/scripts", "tools/macros"],   // folders read (.mjs, .js, .hbs); default: module/scripts
 *     "minKeys": 100,                              // safeguard: the survey must find at least this many keys
 *     "constants": { "NS": "DLO" },                // `${NS}` in a template equals "DLO"
 *     "calls": [{ "fn": "loc", "prefix": "DLO." }],    // loc("Window.Title") asks for DLO.Window.Title
 *     "groups": "DLO",                             // "Window.Title" (first segment = a group of DLO.*) counts as a key
 *     "fileHelpers": [{ "define": "const L = key => [^\\n]*`(?:DLO\\.)?([\\w.]+)\\.\\$\\{key\\}`",
 *                       "call": "L", "prefix": "DLO." }],
 *                                                  // helper local to a file: L("X") asks for <captured prefix>.X
 *     "patterns": [{ "pattern": "\\btoggle\\(\"(\\w+)\"", "keys": ["DLO.Settings.$1.Name", "DLO.Settings.$1.Hint"] }],
 *     "keys": ["DLO.Niveau.off"],                  // keys asked for in another way, to check too
 *     "lists": [{ "prefix": "DLO.Erreur", "file": "core/x.mjs", "export": "CODES" }, { "prefix": "DLO.Mode", "values": ["a"] }],
 *     "allow": { "DLO.Vieux.Nom": "raison" },      // key or start of a key quoted by the code, absent from en: named exception
 *     "langAllow": { "pt-BR:DLO.X": "raison" }     // exception on the language files (key of the failure message)
 *   }
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
// These tests read all the module's code: on the engine (~510 files), in the full pass where the other test files
// occupy all the cores, several seconds. Same delay as loading the module (the engine's tests/load.test.mjs).
vi.setConfig({ testTimeout: 60000 });
const MODULE = join(ROOT, "module");
const configFile = join(ROOT, "tests/das-tests.json");
const CONFIG = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
const SETTINGS = CONFIG.i18n ?? null;
const ALLOW = SETTINGS?.allow ?? {};
const LANG_ALLOW = SETTINGS?.langAllow ?? {};
const used = new Set();
const allowed = (table, key) => { if ( key in table ) { used.add(key); return true; } return false; };

const posix = p => p.split(sep).join("/");
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const filesUnder = (dir, exts) => existsSync(dir) ? readdirSync(dir).sort().flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesUnder(full, exts) : (exts.some(e => name.endsWith(e)) ? [full] : []);
}) : [];

/** The leaves of a language file as dotted keys, whether it is nested or flat. */
function flatten(object, prefix = "", out = {}) {
  for ( const [key, value] of Object.entries(object) ) {
    const path = prefix ? `${prefix}.${key}` : key;
    if ( value && (typeof value === "object") && !Array.isArray(value) ) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
}

const manifest = JSON.parse(readFileSync(join(MODULE, "module.json"), "utf8"));
const declared = manifest.languages ?? [];
/** { lang: { key: value } } of the declared languages whose file can be read. */
const LANGS = {};
const langErrors = [];
for ( const l of declared ) {
  const file = join(MODULE, l.path ?? "");
  if ( !l.path || !existsSync(file) ) { langErrors.push(`module/module.json languages (${l.lang}) — module/${l.path} n'existe pas → créer le fichier ou corriger le chemin`); continue; }
  try { LANGS[l.lang] = flatten(JSON.parse(readFileSync(file, "utf8"))); }
  catch ( e ) { langErrors.push(`module/${l.path} — JSON invalide : ${e.message} → corriger le fichier`); }
}
const EN = LANGS.en ?? {};
const OTHERS = Object.keys(LANGS).filter(l => l !== "en");

describe("fichiers de langue", () => {
  it("chaque fichier est du JSON valide et cité dans module.json, en et fr compris", () => {
    const problems = [...langErrors];
    for ( const l of ["en", "fr"] ) if ( !declared.some(d => d.lang === l) ) problems.push(`module/module.json languages — « ${l} » n'est pas déclaré → l'ajouter`);
    const paths = new Set(declared.map(d => posix(d.path ?? "")));
    for ( const file of filesUnder(join(MODULE, "lang"), [".json"]) ) {
      const path = posix(relative(MODULE, file));
      if ( !paths.has(path) ) problems.push(`module/${path} — pas cité dans module.json « languages » → l'y déclarer (sinon Foundry ne le charge jamais)`);
    }
    expect(problems, "fichiers de langue").toEqual([]);
  });

  it("chaque valeur est un texte non vide", () => {
    const problems = [];
    for ( const [l, flat] of Object.entries(LANGS) ) for ( const [k, v] of Object.entries(flat) ) {
      if ( (typeof v === "string") && v.trim() ) continue;
      if ( allowed(LANG_ALLOW, `${l}:${k}`) ) continue;
      problems.push(`${l}.json « ${k} » — ${typeof v === "string" ? "valeur vide" : `pas un texte (${typeof v})`} → la traduire, ou retirer la clé (exception : "${l}:${k}")`);
    }
    expect(problems, "valeurs vides").toEqual([]);
  });

  it("fr a toutes les clés de en ; aucune langue n'a de clé en trop", () => {
    const problems = [];
    for ( const l of OTHERS ) for ( const k of Object.keys(LANGS[l]) ) {
      if ( (k in EN) || allowed(LANG_ALLOW, `${l}:${k}`) ) continue;
      problems.push(`${l}.json « ${k} » — absente de en.json → la retirer de ${l}.json, ou l'ajouter en anglais (exception : "${l}:${k}")`);
    }
    if ( LANGS.fr ) for ( const k of Object.keys(EN) ) {
      if ( (k in LANGS.fr) || allowed(LANG_ALLOW, `fr:${k}`) ) continue;
      problems.push(`fr.json « ${k} » — manque (présente dans en.json) → la traduire (exception : "fr:${k}")`);
    }
    expect(problems, "clés absentes ou en trop").toEqual([]);
  });

  it("les mêmes {variables} que en dans chaque langue", () => {
    const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(", ");
    const problems = [];
    for ( const l of OTHERS ) for ( const [k, v] of Object.entries(LANGS[l]) ) {
      if ( !(k in EN) || (vars(v) === vars(EN[k])) ) continue;
      if ( allowed(LANG_ALLOW, `${l}:${k}`) ) continue;
      problems.push(`${l}.json « ${k} » — {${vars(v)}} au lieu de {${vars(EN[k])}} (en) → reprendre les variables de l'anglais (exception : "${l}:${k}")`);
    }
    expect(problems, "variables différentes").toEqual([]);
  });

  it("aucune clé n'est le préfixe d'une autre", () => {
    const problems = [];
    for ( const [l, flat] of Object.entries(LANGS) ) {
      const keys = Object.keys(flat).sort();
      const set = new Set(keys);
      for ( const k of keys ) {
        const parts = k.split(".");
        for ( let i = 1; i < parts.length; i++ ) {
          const head = parts.slice(0, i).join(".");
          if ( !set.has(head) || allowed(LANG_ALLOW, `${l}:${head}`) ) continue;
          problems.push(`${l}.json « ${head} » est le préfixe de « ${k} » — Foundry n'en gardera qu'une → renommer l'une des deux (exception : "${l}:${head}")`);
        }
      }
    }
    expect(problems, "clés en conflit").toEqual([]);
  });
});

// ——— Survey of the keys asked for by the code ———

/**
 * The code without comments (replaced by spaces: positions and lines stay correct). With `strings: false`, the
 * content of strings is blanked too (the quotation marks stay; the text of a `${…}` of a template stays code).
 * Literal regular expressions are recognized (a `"` or a `//` inside one opens nothing).
 */
function clean(src, { strings = true } = {}) {
  let out = "";
  let i = 0;
  const blank = s => s.replace(/[^\n]/g, " ");
  const keep = s => strings ? s : blank(s);
  const regexAllowed = () => {
    // The last significant character before the `/` (read backwards: a `replace(/\s+$/)` on the whole text would be quadratic).
    let k = out.length - 1;
    while ( (k >= 0) && /\s/.test(out[k]) ) k--;
    if ( k < 0 ) return true;
    if ( "(,=:[!&|?{};+-*%<>~^".includes(out[k]) ) return true;
    return /\b(return|typeof|case|in|of|new|delete|void|throw|else|yield|await)$/.test(out.slice(Math.max(0, k - 9), k + 1));
  };
  const stack = [];   // for each `${` opened in a template: the depth of braces inside it
  while ( i < src.length ) {
    const c = src[i];
    const next = src[i + 1];
    if ( (c === "/") && (next === "*") ) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, stop)); i = stop;
    }
    else if ( (c === "/") && (next === "/") ) {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop)); i = stop;
    }
    else if ( (c === "/") && regexAllowed() ) {
      let j = i + 1;
      let inClass = false;
      while ( (j < src.length) && (src[j] !== "\n") ) {
        if ( src[j] === "\\" ) { j += 2; continue; }
        if ( src[j] === "[" ) inClass = true;
        else if ( src[j] === "]" ) inClass = false;
        else if ( (src[j] === "/") && !inClass ) break;
        j++;
      }
      out += src.slice(i, Math.min(j + 1, src.length)); i = j + 1;
    }
    else if ( (c === "\"") || (c === "'") ) {
      let j = i + 1;
      while ( (j < src.length) && (src[j] !== c) && (src[j] !== "\n") ) j += (src[j] === "\\") ? 2 : 1;
      const closed = src[j] === c;
      out += c + keep(src.slice(i + 1, j)) + (closed ? c : ""); i = closed ? j + 1 : j;
    }
    else if ( (c === "`") || ((c === "}") && stack.length && (stack.at(-1) === 0)) ) {
      // Start of a template, or return into the template at the end of a `${…}`.
      if ( c === "}" ) stack.pop();
      out += c;
      let j = i + 1;
      while ( (j < src.length) && (src[j] !== "`") && !((src[j] === "$") && (src[j + 1] === "{")) ) j += (src[j] === "\\") ? 2 : 1;
      out += keep(src.slice(i + 1, j));
      if ( src[j] === "`" ) { out += "`"; i = j + 1; }
      else if ( j < src.length ) { out += "${"; stack.push(0); i = j + 2; }
      else i = j;
    }
    else {
      if ( stack.length ) {
        if ( c === "{" ) stack[stack.length - 1]++;
        else if ( c === "}" ) stack[stack.length - 1]--;
      }
      out += c; i++;
    }
  }
  return out;
}


const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NS = SETTINGS?.namespaces ?? [];
const KEY = "[\\w.-]*[\\w-]";

/** `{ keys: Map(clé → "fichier:ligne"), prefixes: Map(début → "fichier:ligne"), branches: Map }` */
let cache = null;
/** The survey, done once for all the tests (it reads all the code: several seconds on the engine). */
const relevé = () => cache ??= scan();

function scan() {
  const keys = new Map();
  const prefixes = new Map();
  const branches = new Map();
  const add = (map, key, where) => { if ( !map.has(key) ) map.set(key, where); };
  const groups = SETTINGS.groups ? new Set(Object.keys(EN).filter(k => k.startsWith(`${SETTINGS.groups}.`)).map(k => k.split(".")[1])) : new Set();
  const nsRe = NS.length ? NS.map(escapeRe).join("|") : null;
  const sources = SETTINGS.sources ?? ["module/scripts"];
  for ( const dir of sources ) for ( const file of filesUnder(join(ROOT, dir), [".mjs", ".js", ".hbs"]) ) {
    let code = clean(readFileSync(file, "utf8"));
    for ( const [name, value] of Object.entries(SETTINGS.constants ?? {}) ) code = code.replaceAll("${" + name + "}", value);
    const path = posix(relative(ROOT, file));
    const at = index => `${path}:${lineOf(code, index)}`;
    // LOCALIZATION_PREFIXES of a data model: branches, not keys.
    const prefixLists = [...code.matchAll(/LOCALIZATION_PREFIXES\s*=\s*\[([^\]]*)\]/g)];
    for ( const m of prefixLists ) for ( const p of m[1].matchAll(/["'`]([^"'`]*)["'`]/g) ) add(branches, p[1], at(m.index));
    const text = prefixLists.reduce((t, m) => t.slice(0, m.index) + " ".repeat(m[0].length) + t.slice(m.index + m[0].length), code);
    // A complete key between quotation marks, or the fixed start of a built key (`DLO.X.${…}`, "DLO.X." + y).
    const take = (m, key) => { if ( (m[3] === "${") || key.endsWith(".") ) add(prefixes, key, at(m.index)); else add(keys, key, at(m.index)); };
    if ( nsRe ) for ( const m of text.matchAll(new RegExp(`(["'\`])((?:${nsRe})\\.[\\w.-]*)(\\1|\\$\\{)`, "g")) ) take(m, m[2]);
    if ( groups.size ) for ( const m of text.matchAll(new RegExp(`(["'\`])([A-Za-z0-9_]+\\.[\\w.-]*)(\\1|\\$\\{)`, "g")) ) {
      if ( groups.has(m[2].split(".")[0]) ) take(m, `${SETTINGS.groups}.${m[2]}`);
    }
    for ( const { fn, prefix = "" } of SETTINGS.calls ?? [] ) {
      const call = `(?<![\\w$.])${escapeRe(fn)}\\(\\s*`;
      for ( const m of text.matchAll(new RegExp(`${call}(["'\`])(${KEY})\\1`, "g")) ) add(keys, prefix + m[2], at(m.index));
      for ( const m of text.matchAll(new RegExp(`${call}\`((?:${KEY}\\.)?)\\$\\{`, "g")) ) add(prefixes, prefix + m[1], at(m.index));
      for ( const m of text.matchAll(new RegExp(`${call}[^()"'\`]*?\\?\\s*(["'])(${KEY})\\1\\s*:\\s*(["'])(${KEY})\\3`, "g")) ) {
        add(keys, prefix + m[2], at(m.index)); add(keys, prefix + m[4], at(m.index));
      }
    }
    for ( const { define, call, prefix = "" } of SETTINGS.fileHelpers ?? [] ) {
      const d = text.match(new RegExp(define));
      if ( !d ) continue;
      const head = d[1].startsWith(prefix) ? d[1] : prefix + d[1];
      for ( const m of text.matchAll(new RegExp(`(?<![\\w$.])${escapeRe(call)}\\(\\s*(["'\`])(${KEY})\\1`, "g")) ) add(keys, `${head}.${m[2]}`, at(m.index));
    }
    for ( const { pattern, keys: templates } of SETTINGS.patterns ?? [] ) {
      for ( const m of text.matchAll(new RegExp(pattern, "g")) ) {
        for ( const t of templates ) add(keys, t.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? ""), at(m.index));
      }
    }
  }
  for ( const k of SETTINGS.keys ?? [] ) add(keys, k, "tests/das-tests.json (i18n.keys)");
  for ( const p of manifest.packs ?? [] ) {
    if ( NS.some(n => String(p.label).startsWith(`${n}.`)) ) add(keys, p.label, `module/module.json (packs ${p.name})`);
  }
  for ( const [doc, types] of Object.entries(manifest.documentTypes ?? {}) ) {
    for ( const type of Object.keys(types ?? {}) ) add(keys, `TYPES.${doc}.${manifest.id}.${type}`, `module/module.json (documentTypes ${doc})`);
  }
  return { keys, prefixes, branches };
}

const run = SETTINGS ? it : it.skip;
const prefixAllowed = key => Object.keys(ALLOW).find(a => (a === key) || (a.endsWith(".") && key.startsWith(a)));
const isAllowed = key => { const a = prefixAllowed(key); if ( a ) used.add(a); return Boolean(a); };

describe("clés demandées par le code" + (SETTINGS ? "" : " (sauté : pas de section i18n dans tests/das-tests.json)"), () => {
  run("chaque clé écrite en dur existe dans en.json", () => {
    const { keys } = relevé();
    expect(keys.size, `le relevé n'a trouvé que ${keys.size} clés : un motif de das-tests.json (i18n) ne marche plus ?`).toBeGreaterThanOrEqual(SETTINGS.minKeys ?? 1);
    const problems = [];
    for ( const [key, where] of keys ) {
      if ( (key in EN) || isAllowed(key) ) continue;
      problems.push(`${where} — « ${key} » absente de en.json → l'ajouter à en.json et fr.json, ou corriger la clé (exception : i18n.allow "${key}")`);
    }
    expect(problems, "clés demandées introuvables (Foundry afficherait la clé brute)").toEqual([]);
  });

  run("chaque début de clé construite commence au moins une clé de en.json", () => {
    const { prefixes } = relevé();
    const enKeys = Object.keys(EN);
    const problems = [];
    for ( const [prefix, where] of prefixes ) {
      if ( enKeys.some(k => k.startsWith(prefix)) || isAllowed(prefix) ) continue;
      problems.push(`${where} — aucune clé de en.json ne commence par « ${prefix} » → ajouter les clés, ou corriger le début (exception : i18n.allow "${prefix}")`);
    }
    expect(problems, "clés construites sans traduction").toEqual([]);
  });

  run("chaque LOCALIZATION_PREFIXES a ses champs traduits (… .FIELDS.…)", () => {
    const { branches } = relevé();
    const problems = [];
    for ( const [prefix, where] of branches ) {
      for ( const l of ["en", "fr"] ) {
        if ( !LANGS[l] || Object.keys(LANGS[l]).some(k => k.startsWith(`${prefix}.FIELDS.`)) || isAllowed(prefix) ) continue;
        problems.push(`${where} — ${l}.json n'a aucune clé « ${prefix}.FIELDS.… » → traduire les champs du modèle (exception : i18n.allow "${prefix}")`);
      }
    }
    expect(problems, "préfixes de champs sans traduction").toEqual([]);
  });

  run("chaque liste déclarée (i18n.lists) a toutes ses clés", async () => {
    const problems = [];
    for ( const list of SETTINGS.lists ?? [] ) {
      let values = list.values;
      if ( list.file ) {
        const mod = await import(pathToFileURL(join(MODULE, "scripts", list.file)).href);
        const found = mod[list.export];
        values = found instanceof Set ? [...found] : Array.isArray(found) ? found : (found && (typeof found === "object")) ? Object.keys(found) : null;
        if ( !values ) { problems.push(`tests/das-tests.json i18n.lists — ${list.file} n'exporte pas de liste « ${list.export} »`); continue; }
      }
      for ( const v of values ?? [] ) {
        const key = `${list.prefix}.${v}`;
        if ( (key in EN) || isAllowed(key) ) continue;
        problems.push(`${list.file ?? "tests/das-tests.json"} — « ${key} » absente de en.json → l'ajouter à en.json et fr.json (exception : i18n.allow "${key}")`);
      }
    }
    expect(problems, "clés de listes introuvables").toEqual([]);
  });

  run("chaque exception (allow, langAllow) sert encore", () => {
    relevé();
    const stale = [...Object.keys(ALLOW), ...Object.keys(LANG_ALLOW)].filter(k => !used.has(k));
    expect(stale, "exceptions qui ne servent plus → les retirer de tests/das-tests.json (i18n)").toEqual([]);
  });
});
