/**
 * Contract with DAS · Core (`dnd5e-combat`) — file COPIED as is from the engine repository
 * (`tools/contract/core-contract.test.mjs`): do not modify it here, copy it again when it changes there.
 *
 * This module calls the engine's public API and listens to its hooks. This test reads `module/scripts/` and checks that every
 * thing asked of the engine exists in its contract, `docs/reference/surface.json` (generated there from the code):
 *   - each API path (`….api.ui.budget`, `engine()?.climb?.state`…);
 *   - each `dnd5e-combat.<nom>` hook listened to (a hook emitted by the engine, or a moment);
 *   - each engine setting read or written (`game.settings.get("dnd5e-combat", "clé")`).
 * A rename or a removal in the engine therefore fails the neighbor's test, before the game session.
 *
 * Where the engine is: the `DAS_CORE` variable (a folder), otherwise the sibling repository `../Foundry dnd5e moteur de combat`,
 * otherwise `core/`. Not found on a machine: the test is skipped; in CI (`CI=true`), it fails — the workflow fetches the engine.
 *
 * What the survey can follow: direct access (`game.modules.get(ID).api.x.y`), the module kept in a variable
 * (`const mod = game.modules.get(ID); mod.api.x`), an access function (`function engine() { … return ….api; }`, then
 * `engine()?.x`, or `engine.content()?.x` after `import * as engine from "./adapter/engine.mjs"`), a local variable that
 * receives the API or a group (`const api = engine()?.combat; api.addEvent`).
 * `CONTRACT_LIST=1 npx vitest run tests/core-contract.test.mjs` prints what it found.
 *
 * Module-specific, optional settings, in `tests/core-contract.json`:
 *   { "roots": ["monAcces\\(\\)"],                            // expressions (regex) that return the engine's API
 *     "dynamic": [{ "pattern": "\\bread\\(\"([A-Za-z]+)\"", "prefix": "ui." }],   // reads by name: `read("budget")`
 *     "allow": ["ui.ancienNom", "dnd5e-combat.vieuxHook", "setting:vieuxReglage"] }   // intended exceptions, justify in the commit
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CORE_ID = "dnd5e-combat";
const ROOT = join(import.meta.dirname, "..");
const SCRIPTS = join(ROOT, "module/scripts");

const corePath = [process.env.DAS_CORE, join(ROOT, "../Foundry dnd5e moteur de combat"), join(ROOT, "core")]
  .filter(Boolean).find(dir => existsSync(join(dir, "docs/reference/surface.json")));
const surface = corePath ? JSON.parse(readFileSync(join(corePath, "docs/reference/surface.json"), "utf8")) : null;
const configPath = join(ROOT, "tests/core-contract.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const allowed = new Set(config.allow ?? []);

function filesUnder(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const full = join(dir, name);
    if ( statSync(full).isDirectory() ) return filesUnder(full);
    return name.endsWith(".mjs") ? [full] : [];
  });
}

/** The code without its comments (a name quoted in a comment is not a call), length and lines preserved. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g, (found, lead="") => lead + found.slice(lead.length).replace(/[^\n]/g, " "));
}

const NAME = "[A-Za-z_$][A-Za-z0-9_$]*";
const TAIL = "\\s*(?:\\?\\?\\s*null\\s*)?;";
const chainPattern = "((?:\\s*\\??\\.\\s*[A-Za-z_$][A-Za-z0-9_$]*)+)";
const escaped = name => name.replace(/\$/g, "\\$");
const segments = chain => chain.split(".").map(part => part.replace(/[\s?]/g, "")).filter(Boolean);
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

const sources = existsSync(SCRIPTS)
  ? filesUnder(SCRIPTS).map(file => ({ file: relative(ROOT, file).split("\\").join("/"), text: code(readFileSync(file, "utf8")) }))
  : [];

/** The constants that equal the engine's identifier somewhere in the module (`ENGINE_ID`, `CORE_ID`, `ID`…). */
const coreConstants = new Set(sources.flatMap(({ text }) => [...text.matchAll(new RegExp(`const\\s+([A-Z][A-Z0-9_]*)\\s*=\\s*"${CORE_ID}"`, "g"))].map(found => found[1])));

/** In this file, the spellings of the engine's identifier: the literal, and the constants that equal nothing else here. */
function idsIn(text) {
  const names = [...coreConstants].filter(name => !new RegExp(`const\\s+${name}\\s*=\\s*"(?!${CORE_ID}")`).test(text));
  return { names, pattern: [`"${CORE_ID}"`, `'${CORE_ID}'`, ...names].join("|") };
}

/** The end of the block that contains `index`: a local variable only holds up to there. */
function blockEnd(text, index) {
  let depth = 0;
  for ( let i = index; i < text.length; i++ ) {
    if ( text[i] === "{" ) depth += 1;
    else if ( (text[i] === "}") && (--depth < 0) ) return i;
  }
  return text.length;
}

const directRoot = text => ({ source: `modules\\.get\\(\\s*(?:${idsIn(text).pattern})\\s*\\)\\s*\\??\\.\\s*api`, prefix: [] });
const callOf = name => `(?<![.\\w$])${escaped(name)}\\(\\s*\\)`;
/** Does this file know this access function: does it declare it, or import it? */
const knows = (text, name) => new RegExp(`(?:function\\s+${escaped(name)}\\s*\\(|const\\s+${escaped(name)}\\s*=|import\\s*\\{[^}]*\\b${escaped(name)}\\b[^}]*\\})`).test(text);
const baseName = path => path.split("/").pop();
/** Les imports en espace de noms d'un fichier : `import * as engine from "./adapter/engine.mjs"` → `{ name: "engine", file: "engine.mjs" }`. */
const namespaces = text => [...text.matchAll(new RegExp(`import\\s*\\*\\s*as\\s+(${NAME})\\s+from\\s*["']([^"']+)["']`, "g"))]
  .map(found => ({ name: found[1], file: baseName(found[2]) }));
/**
 * The ways, in this file, of calling the known access functions: by their name (declared or imported here), or by
 * the namespace of the file that declares them (`engine.content()` after `import * as engine from "./adapter/engine.mjs"`).
 */
function accessorRoots(text, known) {
  const spaces = namespaces(text);
  return known.flatMap(accessor => [
    ...(knows(text, accessor.name) ? [{ source: callOf(accessor.name), prefix: accessor.prefix }] : []),
    ...spaces.filter(space => space.file === baseName(accessor.file))
      .map(space => ({ source: `(?<![.\\w$])${escaped(space.name)}\\s*\\.\\s*${escaped(accessor.name)}\\(\\s*\\)`, prefix: accessor.prefix }))
  ]);
}

/**
 * The module's access functions: `{ name, prefix, file }` —
 * `function engine() { return game.modules.get(ENGINE_ID)?.api ?? null; }`, its multi-line form (short: it reads the engine's
 * module and returns its `.api` as is), and those that derive from it (`const content = () => engine()?.content;`).
 */
function accessors() {
  const found = [];
  const add = (name, prefix, file) => { if ( !found.some(known => known.name === name) ) found.push({ name, prefix, file }); };
  for ( const { text, file } of sources ) {
    const getsCore = new RegExp(`modules\\.get\\(\\s*(?:${idsIn(text).pattern})\\s*\\)`);
    for ( const match of text.matchAll(new RegExp(`(?:function\\s+(${NAME})\\s*\\([^)]*\\)|const\\s+(${NAME})\\s*=\\s*\\([^)]*\\)\\s*=>)\\s*\\{`, "g")) ) {
      const from = match.index + match[0].length;
      const body = text.slice(from, blockEnd(text, from));
      // It must RETURN the API itself (`return mod.api ?? null;`, `return on ? (mod.api ?? null) : null;`), not an object of its
      // own.
      if ( (body.length <= 400) && getsCore.test(body) && /return[^;{]*\.api\s*(?:\?\?\s*null\s*)?\)?\s*(?::\s*null\s*)?;/.test(body) ) add(match[1] ?? match[2], [], file);
    }
  }
  for ( let pass = 0; pass < 3; pass++ ) {
    for ( const { text, file } of sources ) {
      const roots = [directRoot(text), ...accessorRoots(text, found)];
      for ( const root of roots ) {
        const body = `(?:game\\.)?${root.source}${chainPattern}?`;
        const forms = [`function\\s+(${NAME})\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+${body}${TAIL}\\s*\\}`, `const\\s+(${NAME})\\s*=\\s*\\(\\s*\\)\\s*=>\\s*${body}${TAIL}`];
        for ( const form of forms ) for ( const match of text.matchAll(new RegExp(form, "g")) ) add(match[1], [...root.prefix, ...segments(match[2] ?? "")], file);
      }
    }
  }
  return found;
}

/** The API paths asked of the engine: `[{ path, file, line }]`. */
function apiUses() {
  const uses = [];
  const shared = accessors();
  for ( const { file, text } of sources ) {
    // An API name quoted in a string (a log message) is not a call.
    const quoted = index => {
      const line = text.slice(text.lastIndexOf("\n", index) + 1, index);
      return ((line.split("\"").length % 2) === 0) || ((line.split("`").length % 2) === 0);
    };
    const note = (path, index) => { if ( path.length && !quoted(index) ) uses.push({ path, file, line: lineOf(text, index) }); };
    const ids = idsIn(text).pattern;
    // The engine's module kept in a variable of this file: `const mod = game.modules.get(ENGINE_ID);` then `mod.api.x`.
    const holders = [...text.matchAll(new RegExp(`(?:const|let)\\s+(${NAME})\\s*=\\s*game\\.modules\\.get\\(\\s*(?:${ids})\\s*\\)\\s*;`, "g"))]
      .map(found => ({ source: `(?<![.\\w$])${escaped(found[1])}\\s*\\??\\.\\s*api`, prefix: [] }));
    const roots = [directRoot(text), ...holders, ...(config.roots ?? []).map(source => ({ source, prefix: [] })),
      ...accessorRoots(text, shared)];
    for ( const root of roots ) {
      for ( const found of text.matchAll(new RegExp(`${root.source}${chainPattern}`, "g")) ) note([...root.prefix, ...segments(found[1])], found.index);
      // A local variable that receives the API or a group: `const api = engineApi()?.combat;` — followed to the end of its block.
      for ( const found of text.matchAll(new RegExp(`(?:const|let)\\s+(${NAME})\\s*=\\s*(?:game\\.)?${root.source}${chainPattern}?${TAIL}`, "g")) ) {
        const prefix = [...root.prefix, ...segments(found[2] ?? "")];
        const from = found.index + found[0].length;
        const scope = text.slice(from, blockEnd(text, from));
        for ( const use of scope.matchAll(new RegExp(`(?<![.\\w$])${escaped(found[1])}${chainPattern}`, "g")) ) note([...prefix, ...segments(use[1])], from + use.index);
      }
    }
    for ( const { pattern, prefix="" } of config.dynamic ?? [] ) {
      for ( const found of text.matchAll(new RegExp(pattern, "g")) ) note(segments(`${prefix}${found[1]}`), found.index);
    }
  }
  return uses;
}

/** Where a path leaves the contract: null if it is in it (an exact path, a group, or the continuation of a returned value). */
function divergence(path, paths) {
  for ( let n = 1; n <= path.length; n++ ) {
    const prefix = path.slice(0, n).join(".");
    if ( paths.has(prefix) ) return null;   // a function or a value of the contract: what follows belongs to it (`.bind`, a field)
    if ( ![...paths].some(known => known.startsWith(`${prefix}.`)) ) return prefix;
  }
  return null;
}

/** The `dnd5e-combat.<nom>` names written on a line that listens to, emits or names a hook. */
function hookUses() {
  const uses = [];
  for ( const { file, text } of sources ) {
    const forms = [`"${CORE_ID}\\.([A-Za-z0-9]+)"`, `'${CORE_ID}\\.([A-Za-z0-9]+)'`, `\`${CORE_ID}\\.([A-Za-z0-9]+)\``,
      ...idsIn(text).names.map(name => `\`\\$\\{${name}\\}\\.([A-Za-z0-9]+)\``)];
    const lines = text.split("\n");
    for ( const form of forms ) {
      for ( const found of text.matchAll(new RegExp(form, "g")) ) {
        const line = lineOf(text, found.index);
        // The same prefix is used for requests between clients, flags and CSS classes: only a hook line counts.
        if ( !/Hooks\.(on|once|off|call|callAll)\(|_HOOK\b/.test(lines[line - 1]) ) continue;
        uses.push({ name: found[1], file, line });
      }
    }
  }
  return uses;
}

function settingUses() {
  const uses = [];
  for ( const { file, text } of sources ) {
    for ( const found of text.matchAll(new RegExp(`settings\\.(?:get|set)\\(\\s*(?:${idsIn(text).pattern})\\s*,\\s*"([A-Za-z0-9]+)"`, "g")) )
      uses.push({ name: found[1], file, line: lineOf(text, found.index) });
  }
  return uses;
}

const where = use => `${use.file}:${use.line}`;

describe.skipIf(!surface && !process.env.CI)("contrat avec DAS · Core (dnd5e-combat)", () => {
  it("le contrat du moteur est lisible (docs/reference/surface.json)", () => {
    expect(surface, "moteur introuvable : DAS_CORE, ../Foundry dnd5e moteur de combat ou core/").toBeTruthy();
    expect(surface.api.length).toBeGreaterThan(50);
  });

  it("chaque chemin d'API appelé existe dans le moteur", () => {
    const paths = new Set(surface.api);
    const broken = apiUses().map(use => ({ use, at: divergence(use.path, paths) }))
      .filter(({ at }) => at && !allowed.has(at))
      .map(({ use, at }) => `api.${at} (${where(use)})`);
    expect([...new Set(broken)], "absents de docs/reference/surface.json du moteur").toEqual([]);
  });

  it("chaque hook du moteur écouté ou nommé existe (hook émis ou moment)", () => {
    const known = new Set([...surface.hooks.map(name => name.slice(CORE_ID.length + 1)), ...(surface.moments ?? [])]);
    const broken = hookUses().filter(use => !known.has(use.name) && !allowed.has(`${CORE_ID}.${use.name}`))
      .map(use => `${CORE_ID}.${use.name} (${where(use)})`);
    expect([...new Set(broken)], "hooks que le moteur n'émet pas").toEqual([]);
  });

  it("chaque réglage du moteur lu ou écrit existe", () => {
    const known = new Set(surface.settings);
    const broken = settingUses().filter(use => !known.has(use.name) && !allowed.has(`setting:${use.name}`))
      .map(use => `${use.name} (${where(use)})`);
    expect([...new Set(broken)], "réglages absents du moteur").toEqual([]);
  });

  it("le relevé voit bien des appels (sinon le test ne garde rien)", () => {
    const seen = {
      api: [...new Set(apiUses().map(use => use.path.join(".")))].sort(),
      hooks: [...new Set(hookUses().map(use => use.name))].sort(),
      settings: [...new Set(settingUses().map(use => use.name))].sort()
    };
    if ( process.env.CONTRACT_LIST ) console.info(JSON.stringify(seen, null, 1));
    expect(seen.api.length + seen.hooks.length, "aucun appel au moteur trouvé dans module/scripts").toBeGreaterThan(0);
  });
});
