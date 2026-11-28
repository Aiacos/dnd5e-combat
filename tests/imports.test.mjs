import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A name exported by an engine file and called in another file must be imported or defined there. Module loading
 * (tests/load.test.mjs) does not see it: a forgotten import only breaks at the time of the call, in game.
 */
const ROOT = join(import.meta.dirname, "..", "module", "scripts");
const files = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : (p.endsWith(".mjs") ? [p] : []);
});
const ALL = files(ROOT);
const source = Object.fromEntries(ALL.map(f => [f, readFileSync(f, "utf8")]));
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/`[^`]*`/g, "``")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/\.\.\./g, " ");

const exported = new Set();
for ( const s of Object.values(source) ) {
  for ( const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g) ) exported.add(m[1]);
}

describe("imports", () => {
  it("every exported name called in a file is imported or defined there", () => {
    const missing = [];
    for ( const file of ALL ) {
      const s = source[file];
      const known = new Set();
      for ( const m of s.matchAll(/^import\s*\{([^}]*)\}/gm) ) for ( const n of m[1].split(",") ) {
        const local = n.trim().split(/\s+as\s+/).pop();
        if ( local ) known.add(local);
      }
      for ( const m of s.matchAll(/(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g) ) known.add(m[1]);
      for ( const m of s.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g) ) for ( const n of m[1].split(",") ) {
        const local = n.split(":").pop().split("=")[0].trim();
        if ( local ) known.add(local);
      }
      // Function parameters: simple names in parentheses before `=>` or a brace.
      for ( const m of s.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g) ) for ( const n of m[1].split(/[,{}\s=]+/) ) if ( n ) known.add(n);
      // …and those of a `function` signature (on its line), even when a default value contains parentheses.
      for ( const m of s.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\*?\s*[\w$]*\s*\((.*)$/gm) ) {
        for ( const n of m[1].matchAll(/([A-Za-z_$][\w$]*)(?=\s*[,=}])/g) ) known.add(n[1]);
      }
      const body = code(s);
      for ( const name of exported ) {
        if ( known.has(name) ) continue;
        if ( new RegExp(`(?<![\\w$.#])${name.replace(/\$/g, "\\$")}\\(`).test(body) ) missing.push(`${relative(ROOT, file)} : ${name}`);
      }
    }
    expect(missing).toEqual([]);
  }, 30000);   // walks all the engine code: more than 5 s on CI (2026-11-06)
});
