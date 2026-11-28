/**
 * Reading the module code for the guardians (tests/circulation.test.mjs): files, comments removed, calls with their arguments,
 * enclosing function. Not a test: a tool for the tests that read the source, like tests/layers.test.mjs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "../module/scripts");

/** The .mjs files of a module/scripts folder (subfolders included), paths relative to module/scripts. */
export function filesOf(dir) {
  return readdirSync(join(ROOT, dir)).flatMap(f => statSync(join(ROOT, dir, f)).isDirectory() ? filesOf(`${dir}/${f}`)
    : (f.endsWith(".mjs") ? [`${dir}/${f}`] : []));
}

/** All the module's files, layers and entry point. */
export const allFiles = () => ["core", "content", "adapter", "runtime", "ui"].flatMap(filesOf);

/**
 * A file's code, comments replaced by spaces (positions and line numbers stay correct). Strings are kept as they are; a `//`
 * in a string (a URL) is not taken for a comment.
 */
export function code(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  let out = "";
  let i = 0;
  const blank = s => s.replace(/[^\n]/g, " ");
  while ( i < src.length ) {
    const c = src[i];
    if ( (c === "/") && (src[i + 1] === "*") ) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    }
    else if ( (c === "/") && (src[i + 1] === "/") ) {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    }
    else if ( (c === "\"") || (c === "'") || (c === "`") ) {
      let j = i + 1;
      while ( (j < src.length) && (src[j] !== c) ) j += (src[j] === "\\") ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    }
    else { out += c; i++; }
  }
  return out;
}

/** Line number (1…) of a position. */
export const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/** The text between the opening parenthesis at `open` and its closing one (balanced parentheses), without them. */
export function argsAt(text, open) {
  let depth = 0;
  for ( let i = open; i < text.length; i++ ) {
    if ( text[i] === "(" ) depth++;
    else if ( text[i] === ")" && (--depth === 0) ) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const TOP = /^(?:export\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm;

/**
 * The top-level declaration (function, constant) that contains the position: `{ name, body }`. The body runs from the
 * declaration to the next one — enough for a guardian looking for a word in the function of a call.
 */
export function enclosing(text, index) {
  let found = { name: "(module)", start: 0 };
  const decls = [...text.matchAll(TOP)].map(m => ({ name: m[1] ?? m[2], start: m.index }));
  for ( const d of decls ) if ( d.start <= index ) found = d;
  const next = decls.find(d => d.start > found.start && d.start > index);
  return { name: found.name, body: text.slice(found.start, next?.start ?? text.length) };
}

/**
 * Each call `.<méthode>(` of a file: `{ file, line, method, args, fn }` (`fn`: the enclosing declaration).
 * @param {string} file
 * @param {RegExp} methods  E.g. /rollDamage|rollAttack/
 */
export function callsIn(file, methods) {
  const text = code(file);
  const re = new RegExp(`\\.(${methods.source})\\(`, "g");
  return [...text.matchAll(re)].map(m => {
    const open = m.index + m[0].length - 1;
    return { file, line: lineAt(text, m.index), method: m[1], args: argsAt(text, open), fn: enclosing(text, m.index), text };
  });
}
