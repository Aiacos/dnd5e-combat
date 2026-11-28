#!/usr/bin/env node
/**
 * Copies the template tests of the DAS suite (this folder) into the modules' `tests/`: the copy is identical to the template,
 * what is specific to a module stays in its setting files (`tests/das-tests.json`, `tests/core-contract.json`), which
 * this tool never touches.
 *
 *   node tools/contract/sync.mjs           copies the templates into the modules present next to this repository
 *   node tools/contract/sync.mjs --check   copies nothing: says which copies differ from the template (exit code 1 if one differs)
 *
 * Where: the engine's neighboring repositories (`../<dossier>`), from the MODULES list; an absent one is reported and skipped.
 * `core-contract.test.mjs` goes to the neighbors only (the engine is not tested against itself); the `das-*` templates
 * also go into the engine's `tests/`. After a copy: `npm test` in each module, then one commit per repository.
 * No dependency (Node only).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..");
const PARENT = join(CORE, "..");

/** The templates, and who they go to. */
const TEMPLATES = [
  { file: "core-contract.test.mjs", core: false },
  { file: "das-i18n.test.mjs", core: true },
  { file: "das-layers.test.mjs", core: true },
  { file: "das-syntax.test.mjs", core: true }
];

/** The neighboring modules, by folder name (next to the engine's repository). */
const MODULES = [
  "Foundry dnd5e interface de combat",
  "Foundry dnd5e butin et commerce",
  "Foundry dnd5 Vision et lumière",
  "Foundry dnd5e animations",
  "Foundry dnd5e homebrew",
  "Foundry dnd5e PNJ automatisés",
  "Foundry dnd5e manette"
];

const check = process.argv.includes("--check");
// Line endings: a copy checked out as CRLF on Windows is not "different".
const read = file => existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;

const targets = [{ name: "(moteur)", dir: CORE, core: true }, ...MODULES.map(name => ({ name, dir: join(PARENT, name), core: false }))];
let differ = 0;
let missing = 0;
for ( const target of targets ) {
  if ( !existsSync(join(target.dir, "tests")) ) {
    console.log(`?  ${target.name} : dossier absent (${target.dir}), passé`);
    missing++;
    continue;
  }
  for ( const template of TEMPLATES.filter(t => !target.core || t.core) ) {
    const model = read(join(HERE, template.file));
    const copyPath = join(target.dir, "tests", template.file);
    const copy = read(copyPath);
    if ( copy === model ) { console.log(`=  ${target.name} : ${template.file}`); continue; }
    differ++;
    if ( check ) { console.log(`≠  ${target.name} : ${template.file} ${copy === null ? "absent" : "diffère du modèle"}`); continue; }
    writeFileSync(copyPath, model);
    console.log(`→  ${target.name} : ${template.file} ${copy === null ? "créé" : "mis à jour"}`);
  }
}
if ( check ) {
  console.log(differ ? `\n${differ} copie(s) à recopier : node tools/contract/sync.mjs` : "\nToutes les copies sont identiques aux modèles.");
  if ( missing ) console.log(`${missing} dépôt(s) absent(s) de ce poste, non vérifié(s).`);
  process.exitCode = differ ? 1 : 0;
}
else console.log(differ ? `\n${differ} copie(s) écrite(s) : lancer npm test dans chaque module, puis commiter.` : "\nRien à recopier.");
