/**
 * The layers of SPEC §13.3 hold by their imports, not by convention:
 *   core/     imports only core/
 *   content/  imports only content/ and core/
 *   adapter/  never imports runtime/ or ui/
 *   runtime/  never imports ui/ — the interface reads state and emits intents, nothing flows back up
 *   ui/       imports whatever it wants
 * And core/ touches no Foundry global.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../module/scripts");
const LAYERS = ["core", "content", "adapter", "runtime", "ui"];

/** The files of a layer, subfolders included (`runtime/diagnostic/…`). */
const files = dir => readdirSync(join(ROOT, dir)).flatMap(f => statSync(join(ROOT, dir, f)).isDirectory() ? files(`${dir}/${f}`)
  : (f.endsWith(".mjs") ? [`${dir}/${f}`] : []));
const source = file => readFileSync(join(ROOT, file), "utf8");

/** Le chemin (depuis module/scripts) d'un import relatif d'un fichier. */
function resolve(file, spec) {
  const parts = file.split("/").slice(0, -1);
  for ( const seg of spec.split("/") ) {
    if ( seg === "." ) continue;
    if ( seg === ".." ) parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** The layers a file imports: the first folder of the resolved path (`../../runtime/x.mjs` from a subfolder included). */
function importedLayers(file) {
  const out = new Set();
  for ( const [, spec] of source(file).matchAll(/from\s+"([^"]+)"/g) ) {
    if ( !spec.startsWith(".") ) continue;
    const layer = resolve(file, spec).split("/")[0];
    if ( LAYERS.includes(layer) ) out.add(layer);
  }
  return out;
}

const forbidden = {
  core: ["content", "adapter", "runtime", "ui"],
  content: ["adapter", "runtime", "ui"],
  adapter: ["runtime", "ui"],
  runtime: ["ui"],
  ui: []
};

describe("couches", () => {
  for ( const layer of LAYERS ) {
    it(`${layer}/ n'importe pas ${forbidden[layer].join(", ") || "(sans contrainte)"}`, () => {
      for ( const file of files(layer) ) {
        const bad = [...importedLayers(file)].filter(l => forbidden[layer].includes(l));
        expect(bad, file).toEqual([]);
      }
    });
  }

  it("core/ references no Foundry global", () => {
    for ( const file of files("core") ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\b(game|canvas|Hooks|CONFIG|ui)\s*[.[]/);
    }
  });
});

/**
 * §15.1 — a single path for every action: the interface never launches an activity itself
 * (no `use`, no roll, no consumption); it goes through runtime/, which ends in `activity.use()`,
 * hence in `dnd5e.preUseActivity` (aiming, legality) like the sheet and the BG3 bar.
 */
describe("un seul chemin pour toute action", () => {
  it("ui/ n'appelle ni use, ni rollAttack, ni rollDamage, ni consume", () => {
    for ( const file of files("ui") ) {
      const code = source(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");   // commentaires exclus
      expect(code, file).not.toMatch(/\.(use|rollAttack|rollDamage|consume)\(/);
    }
  });

  it("engaging (click, menu, aiming) ends in activity.use()", () => {
    const code = source("runtime/actions.mjs");
    const body = code.slice(code.indexOf("export async function engage"), code.indexOf("/*", code.indexOf("export async function engage")));
    // §436: through `useDespiteAntimagic` (the forceable window under the `antimagic` status), which always calls `activity.use`.
    expect(body).toMatch(/await (activity\.use\(|useDespiteAntimagic\(activity, extra => activity\.use\()/);
  });
});

/**
 * Under Vitest (Vite's transform), an import of a name that does not exist gives `undefined` instead of
 * failing at load: tests/load.test.mjs does not see a broken export. We check it here, by reading:
 * every name imported from a module file must be exported by it (seen on 2026-09-23: `escapeGrapple` imported
 * by ui/pointer.mjs before it existed, tests green).
 */
describe("module imports and exports", () => {
  const exportsOf = (file, seen=new Set()) => {
    const code = source(file);
    const names = new Set();
    if ( seen.has(file) ) return names;
    seen.add(file);
    // `export * from "./x.mjs"`: everything the other file exports (a facade file after splitting).
    for ( const [, spec] of code.matchAll(/export\s*\*\s*from\s*"(\.[^"]+)"/g) ) {
      for ( const name of exportsOf(resolve(file, spec), seen) ) names.add(name);
    }
    for ( const [, name] of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g) ) names.add(name);
    for ( const [, list] of code.matchAll(/export\s*\{([^}]*)\}/g) ) {
      for ( const part of list.split(",") ) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if ( name ) names.add(name);
      }
    }
    return names;
  };
  const allFiles = LAYERS.flatMap(files);

  it("every imported name exists in the file it is imported from", () => {
    const missing = [];
    for ( const file of allFiles ) {
      for ( const [, list, spec] of source(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g) ) {
        const target = resolve(file, spec);
        if ( !allFiles.includes(target) ) continue;
        const available = exportsOf(target);
        for ( const part of list.split(",") ) {
          const name = part.trim().split(/\s+as\s+/)[0]?.trim();
          if ( name && !available.has(name) ) missing.push(`${file} → ${name} (de ${target})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
