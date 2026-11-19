/**
 * §472 : chaque requête entre clients (`CONFIG.queries[…] = gestionnaire`) lit son expéditeur (`(données, { user })`, le cœur V14 le passe,
 * users.mjs:225) — une requête se fabrique dans la console d'un joueur. Celles qui n'en ont pas besoin (une fenêtre où le destinataire
 * décide, un texte flottant) sont nommées, avec leur raison, dans `tests/das-tests.json` → `requests.noSender` ; une exception périmée
 * (le gestionnaire lit désormais l'expéditeur, ou n'existe plus) échoue aussi.
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

/** Les paramètres d'une fonction, de la parenthèse ouvrante à sa fermante. */
function paramsFrom(text, open) {
  let depth = 0;
  for ( let i = open; i < text.length; i++ ) {
    if ( text[i] === "(" ) depth++;
    else if ( text[i] === ")" && (--depth === 0) ) return text.slice(open + 1, i);
  }
  return "";
}

/** Le gestionnaire lit-il son expéditeur ? Un second paramètre (`{ user }`, `options`) le dit. */
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

/** Combien de virgules au premier niveau (hors accolades, crochets, parenthèses) : le nombre de paramètres moins un. */
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

describe("requêtes entre clients : l'expéditeur (§472)", () => {
  it("chaque gestionnaire lit son expéditeur, ou son exception est motivée", () => {
    const missing = registrations.filter(r => !readsSender(r.handler, r.file) && !allowed[r.key])
      .map(r => `${r.file.path} : ${r.key}`);
    expect(missing, "lire { user } (core/requests.mjs) ou motiver dans das-tests.json → requests.noSender").toEqual([]);
  });

  it("chaque exception est encore utile", () => {
    const stale = Object.keys(allowed).filter(key => {
      const found = registrations.filter(r => r.key === key);
      return !found.length || found.every(r => readsSender(r.handler, r.file));
    });
    expect(stale).toEqual([]);
    for ( const [key, why] of Object.entries(allowed) ) expect(String(why).length, key).toBeGreaterThan(20);
  });

  it("le relevé trouve bien les requêtes", () => {
    expect(registrations.length).toBeGreaterThan(40);
  });
});
