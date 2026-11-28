/**
 * Diagnostic backups (SPEC §177): pure rules, tested by tests/backup.test.mjs.
 *
 * Before any repair, each document touched ("root") is copied into an entry of the "DAS · Backups" compendium;
 * restoring puts the root back exactly as it was. Three kinds of roots:
 *   Actor  a world actor (its items and effects included);
 *   Item   a world item (its effects included);
 *   Token  an unlinked token: its own copy of the actor (what its items and effects became in its delta).
 */

/** The embedded collections of a root, by kind. */
export const EMBEDDED = Object.freeze({ Actor: ["items", "effects"], Item: ["effects"], Token: ["items", "effects"] });

/** The fields a restoration never puts back (identity, sorting, ownership, history). */
export const KEPT_FIELDS = Object.freeze(["_id", "_stats", "folder", "sort", "ownership"]);

/**
 * What to do with an embedded collection to return to the backup: delete what was not there, recreate what has
 * disappeared (with its id), put the rest back identically.
 * @param {{ _id: string }[]} current   The current embedded documents (data).
 * @param {{ _id: string }[]} saved     Those of the backup.
 * @returns {{ remove: string[], create: object[], update: object[] }}
 */
export function restorePlan(current=[], saved=[]) {
  const now = new Set(current.map(d => d._id));
  const then = new Map(saved.map(d => [d._id, d]));
  return {
    remove: [...now].filter(id => !then.has(id)),
    create: saved.filter(d => !now.has(d._id)),
    update: saved.filter(d => now.has(d._id))
  };
}

/** The top-level data of a root to put back (without its embedded collections or the kept fields). */
export function rootFields(type, data) {
  const skip = new Set([...KEPT_FIELDS, ...(EMBEDDED[type] ?? [])]);
  return Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !skip.has(k)));
}

/** The key of a root (to back it up only once). */
export const rootKey = root => `${root.type}:${root.uuid}`;

/** The distinct roots of a task list (in order of first appearance). */
export function uniqueRoots(tasks) {
  const seen = new Map();
  for ( const t of tasks ?? [] ) if ( t?.root && !seen.has(rootKey(t.root)) ) seen.set(rootKey(t.root), t.root);
  return [...seen.values()];
}

/**
 * Is a backup read back complete? Each expected root must be there, with exactly the same item and effect ids
 * as the original at the time of the copy. Returns the list of problems (empty: complete).
 * @param {{ type: string, uuid: string, data: object }[]} expected   What was copied.
 * @param {{ type: string, uuid: string, data: object }[]} readBack   What the compendium returns.
 */
export function verifyBackup(expected, readBack) {
  const problems = [];
  const got = new Map((readBack ?? []).map(r => [rootKey(r), r]));
  for ( const e of expected ?? [] ) {
    const r = got.get(rootKey(e));
    if ( !r ) { problems.push(`missing ${rootKey(e)}`); continue; }
    for ( const field of EMBEDDED[e.type] ?? [] ) {
      const a = (e.data?.[field] ?? []).map(d => d._id).sort().join(",");
      const b = (r.data?.[field] ?? []).map(d => d._id).sort().join(",");
      if ( a !== b ) problems.push(`${rootKey(e)}: ${field} differ`);
    }
  }
  return problems;
}

/** The name of a backup entry: "Diagnostic — 2026-10-13 14:05 (3)". */
export function backupName(label, date, count) {
  const pad = n => String(n).padStart(2, "0");
  const d = new Date(date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${label} — ${stamp} (${count})`;
}
