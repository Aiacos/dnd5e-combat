#!/usr/bin/env node
/**
 * Regenerates the engine reference in `docs/reference/`: public API, hooks, settings, content, scenarios, and
 * `surface.json` (the contract for the neighbors). Everything is re-read from the code (`tools/lib/reference.mjs`).
 *   npm run reference            writes the pages
 *   node tools/reference.mjs --check   says what is out of date, without writing anything
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, REFERENCE_DIR } from "./lib/reference.mjs";

const check = process.argv.includes("--check");
const pages = await build();
let stale = 0;
if ( !check ) mkdirSync(REFERENCE_DIR, { recursive: true });
for ( const [name, text] of Object.entries(pages) ) {
  const file = join(REFERENCE_DIR, name);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if ( current === text ) continue;
  stale += 1;
  if ( check ) console.error(`reference | ${name} n'est plus à jour`);
  else { writeFileSync(file, text); console.log(`reference | ${name} écrit`); }
}
if ( !stale ) console.log("reference | tout est à jour");
if ( check && stale ) { console.error("reference | npm run reference"); process.exitCode = 1; }
