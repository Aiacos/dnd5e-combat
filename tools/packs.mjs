/**
 * Builds the module's compendiums (module/packs/, not versioned) from their versioned sources (SPEC §56).
 *
 *   npm run packs
 *
 * Today just one: `outils`, the macros of tools/macros/ (list and order: tools/macros/index.mjs). Ids are derived from the file
 * name: a macro keeps the same id from one version to the next. Run with Foundry closed, or the module inactive in the open world
 * (Foundry holds an exclusive lock on an open database).
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { ClassicLevel } from "classic-level";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MACROS } from "./macros/index.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module", "module.json"), "utf8"));

/** A stable Foundry `_id`: 16 alphanumeric characters derived from the name. */
export function stableId(name) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return [...createHash("sha256").update(name).digest()].slice(0, 16).map(b => chars[b % chars.length]).join("");
}

/** The documents of the `outils` pack. */
export function macroDocuments() {
  return MACROS.map(({ file, name, img }, i) => {
    const _id = stableId(`dnd5e-combat.outils.${file}`);
    return {
      _id, _key: `!macros!${_id}`, name, type: "script", img, scope: "global", folder: null, sort: (i + 1) * 100000,
      command: fs.readFileSync(path.join(ROOT, "tools", "macros", file), "utf8").replace(/\r\n/g, "\n"),
      author: null, ownership: { default: 0 }, flags: { "dnd5e-combat": { source: `tools/macros/${file}` } }
    };
  });
}

const SOURCES = { outils: macroDocuments };

/** A database opened by Foundry is locked: we check BEFORE touching the folder (otherwise it would be half erased). */
async function assertUnlocked(dir) {
  if ( !fs.existsSync(dir) ) return;
  const db = new ClassicLevel(dir);
  try { await db.open(); }
  catch(err) {
    console.error(`  ✗ ${path.relative(ROOT, dir)} est ouvert par Foundry : fermer le monde (ou désactiver le module), puis relancer.`);
    process.exit(1);
  }
  await db.close();
}

if ( import.meta.main ?? (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) ) {
  for ( const pack of manifest.packs ?? [] ) {
    const documents = SOURCES[pack.name]?.();
    if ( !documents ) throw new Error(`pas de source pour le compendium ${pack.name}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dnd5e-combat-${pack.name}-`));
    for ( const doc of documents ) fs.writeFileSync(path.join(tmp, `${doc._id}.json`), JSON.stringify(doc, null, 2));
    const dst = path.join(ROOT, "module", pack.path);
    await assertUnlocked(dst);
    fs.rmSync(dst, { recursive: true, force: true });
    await compilePack(tmp, dst);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`  ✓ ${pack.name} : ${documents.length} document(s) → module/${pack.path}`);
  }
}
