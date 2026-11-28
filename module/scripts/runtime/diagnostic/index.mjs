/**
 * The world diagnostic (SPEC §177): analyze (nothing is written), then repair what the GM ticked — after a verified backup
 * of each touched document. If the backup fails or is incomplete, nothing is modified. Each task is repaired
 * alone: an error does not stop the following ones and is read in the report. A backup can be restored (backup.mjs).
 */
import { MODULE_ID } from "../../constants.mjs";
import { uniqueRoots } from "../../core/backup.mjs";
import { CHECKS, allChecks, registerImporter, unregisterImporter } from "./checks.mjs";
import { createBackup, listBackups, restoreBackup } from "./backup.mjs";
import { loc, log } from "../shared.mjs";

let busy = false;

/** Analysis: `{ [checkId]: tâches }`. Each task gets an id stable for this analysis. Writes nothing. */
export async function scanWorld(ids=null) {
  if ( !game.user.isGM ) throw new Error("only a GM can run the diagnostic");
  const out = {};
  for ( const check of allChecks() ) {
    if ( ids && !ids.includes(check.id) ) continue;
    try {
      out[check.id] = (await check.scan()).map((task, i) => ({ ...task, check: check.id, id: `${check.id}.${i}` }));
    } catch(err) {
      console.error(`${MODULE_ID} | diagnostic ${check.id}`, err);
      out[check.id] = [{ check: check.id, id: `${check.id}.error`, where: "", text: loc("Diagnostic.AnalyseEchec", { error: err.message }) }];
    }
  }
  return out;
}

/**
 * Repairs these tasks. Returns `{ backup, results: [{ task, ok, line }] }`. Throws if the backup could not be made (nothing has
 * then been modified). `options`: `{ [checkId]: { [optionId]: valeur } }`, a check's options (`check.options`),
 * passed to the `apply` of each of its tasks.
 */
export async function repairTasks(tasks, options={}) {
  if ( !game.user.isGM ) throw new Error("only a GM can repair");
  if ( busy ) throw new Error(loc("Diagnostic.Occupe"));
  const todo = tasks.filter(t => typeof t.apply === "function" && t.root);
  if ( !todo.length ) return { backup: null, results: [] };
  busy = true;
  try {
    const backup = await createBackup(uniqueRoots(todo), { label: loc("Diagnostic.Titre"), checks: [...new Set(todo.map(t => t.check))] });
    const results = [];
    for ( const task of todo ) {
      try {
        results.push({ task, ok: true, line: await task.apply(options[task.check] ?? {}) });
      } catch(err) {
        // The task's document was removed by an earlier repair of this pass (fresh.mjs): not a failure.
        if ( err?.vanished ) { results.push({ task, ok: true, line: loc("Diagnostic.ReparationDisparu") }); continue; }
        console.error(`${MODULE_ID} | repair ${task.id}`, err);
        results.push({ task, ok: false, line: loc("Diagnostic.ReparationEchec", { error: foundry.utils.escapeHTML(err.message) }) });
      }
    }
    log(`diagnostic: ${results.filter(r => r.ok).length}/${results.length} repaired, backup ${backup.name}`);
    return { backup, results };
  } finally {
    busy = false;
  }
}

/** Restores a backup (after making one of the current state). */
export async function restore(uuid) {
  if ( busy ) throw new Error(loc("Diagnostic.Occupe"));
  busy = true;
  try { return await restoreBackup(uuid); }
  finally { busy = false; }
}

export { CHECKS, allChecks, registerImporter, unregisterImporter, listBackups };
