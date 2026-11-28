/**
 * §472: each request between clients (`CONFIG.queries[…] = gestionnaire`) reads its sender (`(données, { user })`, the V14 core
 * passes it, users.mjs:225) — a request can be forged from a player's console. Those that do not need it (a window where
 * the recipient decides, a floating text) are named, with their reason, in `tests/das-tests.json` → `requests.noSender`; a stale
 * exception (the handler now reads the sender, or no longer exists) also fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPTS = join(ROOT, "module", "scripts");
const config = JSON.parse(readFileSync(join(ROOT, "tests", "das-tests.json"), "utf8"));
const allowed = config.requests?.noSender ?? {};

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : (path.endsWith(".mjs") ? [path] : []);
  });
}

const sources = files(SCRIPTS).map(path => ({ path: relative(SCRIPTS, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));

/** A function's parameters, from the opening parenthesis to its closing one. */
function paramsFrom(text, open) {
  let depth = 0;
  for ( let i = open; i < text.length; i++ ) {
    if ( text[i] === "(" ) depth++;
    else if ( text[i] === ")" && (--depth === 0) ) return text.slice(open + 1, i);
  }
  return "";
}

/** Does the handler read its sender? A second parameter (`{ user }`, `options`) says so. */
function readsSender(handler, file) {
  if ( /^(?:async\s*)?\(/.test(handler) ) return topLevelCommas(paramsFrom(handler, handler.indexOf("("))) >= 1;
  const name = handler.match(/^[A-Za-z_$][\w$]*/)?.[0];
  if ( !name ) return false;
  const own = [file, ...sources.filter(s => s !== file)];
  for ( const s of own ) {
    const m = new RegExp(String.raw`(?:function\s+${name}\s*|const\s+${name}\s*=\s*(?:async\s*)?)\(`).exec(s.text);
    if ( m ) return topLevelCommas(paramsFrom(s.text, m.index + m[0].length - 1)) >= 1;
  }
  return false;
}

/** How many commas at the top level (outside braces, brackets, parentheses): the number of parameters minus one. */
function topLevelCommas(params) {
  let depth = 0, n = 0;
  for ( const c of params ) {
    if ( "{[(".includes(c) ) depth++;
    else if ( "}])".includes(c) ) depth--;
    else if ( (c === ",") && !depth ) n++;
  }
  return n;
}

const registrations = sources.flatMap(file => [...file.text.matchAll(/CONFIG\.queries\[([^\]]+)\]\s*=\s*([^;\n]+)/g)]
  .map(m => ({ key: m[1].trim(), handler: m[2].trim(), file })));

describe("requests between clients: the sender (§472)", () => {
  it("each handler reads its sender, or its exception is justified", () => {
    const missing = registrations.filter(r => !readsSender(r.handler, r.file) && !allowed[r.key])
      .map(r => `${r.file.path} : ${r.key}`);
    expect(missing, "lire { user } (core/requests.mjs) ou motiver dans das-tests.json → requests.noSender").toEqual([]);
  });

  it("each exception is still useful", () => {
    const stale = Object.keys(allowed).filter(key => {
      const found = registrations.filter(r => r.key === key);
      return !found.length || found.every(r => readsSender(r.handler, r.file));
    });
    expect(stale).toEqual([]);
    for ( const [key, why] of Object.entries(allowed) ) expect(String(why).length, key).toBeGreaterThan(20);
  });

  it("the survey does find the requests", () => {
    expect(registrations.length).toBeGreaterThan(40);
  });
});
