/**
 * DAS test base — SYNTAX AND MANIFEST. File COPIED as is from the engine repository
 * (`tools/contract/das-syntax.test.mjs`): do not modify it here. In the engine, `node tools/contract/sync.mjs` copies it again
 * into all modules; what is specific to a module goes in `tests/das-tests.json`, section `"manifest"`.
 *
 * Checks, without Foundry:
 *   1. each `.mjs` of `module/scripts/` parses without a syntax error (a typo in a file that no test
 *      imports prevents the whole module from loading in game: seen on DAS · Combat UI 0.25.2);
 *   2. each relative import (`from "./x.mjs"`, `import("./x.mjs")`) targets a file that exists, and each imported name
 *      (`import { a } from`) is exported by that file — under Vitest a missing name becomes `undefined` without an error;
 *   3. each file cited by `module/module.json` exists: `esmodules`, `scripts`, `styles`, `languages`, and `packs`
 *      (a compendium built by `npm run packs` is not versioned: its source is declared in `packSources`);
 *   4. the manifest is consistent: `id` (= `name` of package.json), `version` X.Y.Z, `compatibility` (minimum ≤ verified),
 *      `url` / `manifest` / `download` on the same GitHub repository (`…/releases/latest/download/module.json` and `module.zip`),
 *      `dnd5e` system declared.
 *
 * Setting (optional), `tests/das-tests.json`:
 *   "manifest": {
 *     "packSources": { "outils": "tools/macros" },       // compendium → folder (from the repository root) it is built from
 *     "except": { "imports:ui/x.mjs → ./vieux.mjs": "raison" }   // named exceptions (key = that of the failure message)
 *   }
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dirname, "..");
// These tests read all the module's code: on the engine (~510 files), in the full pass where the other test files
// occupy all the cores, several seconds. Same delay as loading the module (the engine's tests/load.test.mjs).
vi.setConfig({ testTimeout: 60000 });
const MODULE = join(ROOT, "module");
const SCRIPTS = join(MODULE, "scripts");
const configFile = join(ROOT, "tests/das-tests.json");
const CONFIG = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
const SETTINGS = CONFIG.manifest ?? {};
const EXCEPT = SETTINGS.except ?? {};
const used = new Set();
/** Is a defect a named exception of the setting? */
const excepted = key => { if ( key in EXCEPT ) { used.add(key); return true; } return false; };

const posix = p => p.split(sep).join("/");
const filesUnder = dir => existsSync(dir) ? readdirSync(dir).sort().flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? filesUnder(full) : (name.endsWith(".mjs") ? [full] : []);
}) : [];
const FILES = filesUnder(SCRIPTS);
const rel = file => posix(relative(SCRIPTS, file));
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

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

/** Code without comments, strings kept (to read the import paths). */
const CODE = Object.fromEntries(FILES.map(f => [f, clean(readFileSync(f, "utf8"))]));

describe("syntaxe des scripts du module", () => {
  it("chaque fichier .mjs s'analyse sans erreur", () => {
    expect(FILES.length, "aucun fichier dans module/scripts/").toBeGreaterThan(0);
    // A single process for all the files (vm.SourceTextModule parses without executing); `node --check` afterwards,
    // on the faulty files only, for the line.
    const script = `const vm = require("node:vm"), fs = require("node:fs");
      const bad = [];
      for ( const f of JSON.parse(fs.readFileSync(0, "utf8")) ) {
        try { new vm.SourceTextModule(fs.readFileSync(f, "utf8"), { identifier: f }); }
        catch ( e ) { bad.push({ f, message: e.message }); }
      }
      process.stdout.write(JSON.stringify(bad));`;
    const r = spawnSync(process.execPath, ["--experimental-vm-modules", "--no-warnings", "-e", script],
      { input: JSON.stringify(FILES), encoding: "utf8", maxBuffer: 1 << 26 });
    expect(r.status, r.stderr).toBe(0);
    const bad = JSON.parse(r.stdout).filter(({ f }) => !excepted(`syntax:${rel(f)}`)).map(({ f, message }) => {
      const check = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
      const where = check.stderr.match(/:(\d+)\s*\n/)?.[1];
      return `module/scripts/${rel(f)}${where ? `:${where}` : ""} — ${message} → corriger la syntaxe de ce fichier`;
    });
    expect(bad, "fichiers qui ne s'analysent pas (le module entier ne se chargerait pas en jeu)").toEqual([]);
  });
});

/** The names exported by a module file (`export * from` followed). */
function exportsOf(file, seen = new Set()) {
  const names = new Set();
  if ( seen.has(file) || !(file in CODE) ) return names;
  seen.add(file);
  const code = CODE[file];
  for ( const [, spec] of code.matchAll(/export\s*\*\s*from\s*["'](\.[^"']+)["']/g) ) {
    for ( const n of exportsOf(resolve(dirname(file), spec), seen) ) if ( n !== "default" ) names.add(n);
  }
  for ( const [, n] of code.matchAll(/export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from/g) ) names.add(n);
  for ( const [, n] of code.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s*([A-Za-z_$][\w$]*)/g) ) names.add(n);
  for ( const [, list] of code.matchAll(/export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/g) ) {
    for ( const part of list.split(",") ) {
      const n = part.split(":").pop().split("=")[0].trim();
      if ( n ) names.add(n);
    }
  }
  for ( const [, list] of code.matchAll(/export\s*\{([^}]*)\}/g) ) {
    for ( const part of list.split(",") ) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if ( n ) names.add(n);
    }
  }
  if ( /export\s+default\b/.test(code) ) names.add("default");
  return names;
}

describe("imports relatifs du module", () => {
  it("chaque import relatif vise un fichier qui existe", () => {
    const missing = [];
    for ( const file of FILES ) {
      const code = CODE[file];
      const specs = [
        ...code.matchAll(/(?:^|[;}])\s*(?:import|export)\b[^;"'`]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/gm),
        ...code.matchAll(/(?:^|[;}])\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm),
        ...code.matchAll(/(?<![\w$.])import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)
      ];
      for ( const m of specs ) {
        const target = resolve(dirname(file), m[1]);
        if ( existsSync(target) ) continue;
        if ( excepted(`imports:${rel(file)} → ${m[1]}`) ) continue;
        missing.push(`module/scripts/${rel(file)}:${lineOf(code, m.index + m[0].lastIndexOf(m[1]))} — « ${m[1]} » n'existe pas → corriger le chemin ou créer le fichier`
          + ` (exception : "imports:${rel(file)} → ${m[1]}")`);
      }
    }
    expect(missing, "imports vers des fichiers absents").toEqual([]);
  });

  it("chaque nom importé est exporté par le fichier d'où on l'importe", () => {
    const missing = [];
    for ( const file of FILES ) {
      const code = CODE[file];
      for ( const m of code.matchAll(/(?:^|[;}])\s*import\s+([^"';]*?)\s+from\s*["'](\.{1,2}\/[^"']+)["']/gm) ) {
        const target = resolve(dirname(file), m[2]);
        if ( !(target in CODE) ) continue;
        const clause = m[1];
        const wanted = [];
        const named = clause.match(/\{([^}]*)\}/);
        if ( named ) for ( const part of named[1].split(",") ) {
          const n = part.trim().split(/\s+as\s+/)[0]?.trim();
          if ( n ) wanted.push(n);
        }
        const head = clause.replace(/\{[^}]*\}/, "").replace(/\*\s*as\s+[\w$]+/, "").replace(/,/g, " ").trim();
        if ( head ) wanted.push("default");
        const available = exportsOf(target);
        for ( const n of wanted ) {
          if ( available.has(n) ) continue;
          const key = `exports:${rel(file)} → ${rel(target)}#${n}`;
          if ( excepted(key) ) continue;
          missing.push(`module/scripts/${rel(file)}:${lineOf(code, m.index + m[0].indexOf("import"))} — « ${n} » n'est pas exporté par ${rel(target)}`
            + ` → l'exporter là-bas ou corriger l'import (exception : "${key}")`);
        }
      }
    }
    expect(missing, "noms importés qui n'existent pas (ils vaudraient undefined)").toEqual([]);
  });
});

describe("manifeste module/module.json", () => {
  const manifestFile = join(MODULE, "module.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));

  it("chaque fichier cité existe", () => {
    const missing = [];
    const check = (field, path, why = "") => {
      if ( !path ) return;
      if ( existsSync(join(MODULE, path)) || excepted(`file:${path}`) ) return;
      missing.push(`module/module.json « ${field} » — module/${path} n'existe pas${why} → créer le fichier ou corriger le chemin`);
    };
    for ( const p of manifest.esmodules ?? [] ) check("esmodules", p);
    for ( const p of manifest.scripts ?? [] ) check("scripts", p);
    for ( const p of manifest.styles ?? [] ) check("styles", typeof p === "string" ? p : p?.src);
    for ( const l of manifest.languages ?? [] ) check(`languages (${l.lang})`, l.path);
    // A compendium ignored by git (built by `npm run packs`) does not exist on CI nor after a clone: we look at its source.
    const ignored = existsSync(join(ROOT, ".gitignore")) ? readFileSync(join(ROOT, ".gitignore"), "utf8").split(/\r?\n/)
      .map(l => l.trim().replace(/^\//, "").replace(/\/$/, "")).filter(l => l && !l.startsWith("#") && !/[*!?]/.test(l)) : [];
    for ( const pack of manifest.packs ?? [] ) {
      const built = `module/${pack.path}`.replace(/\/$/, "");
      const generated = ignored.some(l => (built === l) || built.startsWith(`${l}/`));
      if ( !generated && existsSync(join(MODULE, pack.path)) ) continue;
      const source = SETTINGS.packSources?.[pack.name];
      if ( source && existsSync(join(ROOT, source)) ) continue;
      if ( excepted(`file:${pack.path}`) ) continue;
      missing.push(source
        ? `module/module.json « packs » ${pack.name} — sa source ${source} (das-tests.json, manifest.packSources) n'existe pas → corriger le chemin`
        : `module/module.json « packs » ${pack.name} — module/${pack.path} ${generated ? "est construit (ignoré par git)" : "n'existe pas"} → s'il est construit (npm run packs), déclarer sa source dans tests/das-tests.json : "manifest": { "packSources": { "${pack.name}": "<dossier>" } }`);
    }
    expect(missing, "fichiers cités par module.json introuvables").toEqual([]);
  });

  it("id, version, compatibilité, système et adresses cohérents", () => {
    const problems = [];
    const say = (key, text) => { if ( !excepted(`manifest:${key}`) ) problems.push(`module/module.json « ${key} » — ${text} (exception : "manifest:${key}")`); };
    const pkgFile = join(ROOT, "package.json");
    const pkg = existsSync(pkgFile) ? JSON.parse(readFileSync(pkgFile, "utf8")) : null;
    if ( !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id ?? "") ) say("id", `« ${manifest.id} » : minuscules, chiffres et tirets seulement`);
    if ( pkg && (pkg.name !== manifest.id) ) say("id", `« ${manifest.id} » ≠ package.json name « ${pkg.name} » → aligner les deux`);
    if ( !/^\d+\.\d+\.\d+$/.test(manifest.version ?? "") ) say("version", `« ${manifest.version} » n'est pas de la forme X.Y.Z (le tag de release doit être vX.Y.Z)`);
    const { minimum, verified } = manifest.compatibility ?? {};
    const parts = v => String(v).split(".").map(Number);
    const older = (a, b) => { const x = parts(a), y = parts(b); for ( let i = 0; i < Math.max(x.length, y.length); i++ ) { if ( (x[i] ?? 0) !== (y[i] ?? 0) ) return (x[i] ?? 0) < (y[i] ?? 0); } return false; };
    if ( !minimum || !verified ) say("compatibility", "minimum et verified sont attendus");
    else if ( older(verified, minimum) ) say("compatibility", `verified ${verified} est plus ancien que minimum ${minimum}`);
    if ( !(manifest.relationships?.systems ?? []).some(s => s.id === "dnd5e") ) say("relationships", "le système dnd5e n'est pas déclaré dans relationships.systems");
    const repo = String(manifest.url ?? "").match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)$/)?.[1];
    if ( !repo ) say("url", `« ${manifest.url} » n'est pas l'adresse d'un dépôt GitHub (https://github.com/<compte>/<dépôt>)`);
    else {
      const base = `https://github.com/${repo}/releases/latest/download`;
      if ( manifest.manifest !== `${base}/module.json` ) say("manifest", `« ${manifest.manifest} » ≠ ${base}/module.json`);
      if ( manifest.download !== `${base}/module.zip` ) say("download", `« ${manifest.download} » ≠ ${base}/module.zip`);
    }
    expect(problems, "manifeste incohérent").toEqual([]);
  });
});

describe("réglage tests/das-tests.json", () => {
  it("chaque exception de la section manifest sert encore", async () => {
    // The other tests of this file ran before: an exception never encountered is stale.
    const stale = Object.keys(EXCEPT).filter(k => !used.has(k));
    expect(stale, "exceptions qui ne servent plus → les retirer de tests/das-tests.json (manifest.except)").toEqual([]);
  });
});
