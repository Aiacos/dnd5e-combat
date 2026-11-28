/**
 * §439: the update message — the pure part (no Foundry global). The notes themselves are data
 * (`content/releases.mjs`, one entry per published version); here, what is drawn from them for a given world:
 *  - `notesBetween`: the notes of the versions released since the last one seen by the GM;
 *  - `lateModules`  : the suite modules installed below the version this version was tested with;
 *  - `compatibility`: Foundry, the system and the installed books against the tested versions;
 *  - `activeRisks` / `recommendedChecks`: the hand-written risks and the recommended diagnostic checks, when their
 *    condition (`when`) is met in this world;
 *  - `validateReleases`: the release safeguard (tests/release-notes.test.mjs).
 *
 * "Installed" (`installed`): `{ foundry, system, modules: [{ id, title, version, active }] }`, read by the interface.
 */

const VERSION = /^\d+(\.\d+)*$/;

const parts = v => String(v ?? "").trim().split(".").map(s => Number.parseInt(s, 10) || 0);

/** Compares two versions "0.283.0", "14.370": negative if `a` is older, 0 if equal, positive if newer. */
export function compareVersions(a, b) {
  const pa = parts(a), pb = parts(b);
  for ( let i = 0; i < Math.max(pa.length, pb.length); i++ ) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if ( d ) return d;
  }
  return 0;
}

/**
 * The gap between an installed version and the tested version: `null` if equal, otherwise `{ way: "older" | "newer", level }`.
 * Only the last number differs (14.370 → 14.371, 6.1.0 → 6.1.2): a fix, `info`. A number before it: `warn`.
 */
export function versionGap(installed, tested) {
  const diff = compareVersions(installed, tested);
  if ( !diff ) return null;
  const pi = parts(installed), pt = parts(tested);
  const last = Math.max(pi.length, pt.length) - 1;
  let first = 0;
  while ( (pi[first] ?? 0) === (pt[first] ?? 0) ) first++;
  return { way: diff < 0 ? "older" : "newer", level: first < last ? "warn" : "info" };
}

/** The note of an exact version, or `null`. */
export const noteOf = (releases, version) => releases.find(r => r.version === version) ?? null;

/**
 * The notes to show, from the most recent to the oldest: those of the versions after `seen` up to and including `current`.
 * Without `seen` (opened by hand): the last `limit` ones up to `current`.
 */
export function notesBetween(releases, { seen=null, current, limit=5 }={}) {
  const upTo = releases.filter(r => compareVersions(r.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  if ( !seen ) return upTo.slice(0, limit);
  return upTo.filter(r => compareVersions(r.version, seen) > 0);
}

/** The tested versions that apply to `current`: those of the most recent note that does not exceed it. */
export function testedFor(releases, current) {
  return notesBetween(releases, { current, limit: 1 })[0]?.tested ?? null;
}

const activeModule = (installed, id) => (installed?.modules ?? []).find(m => (m.id === id) && m.active) ?? null;

/** The suite modules active in this world and older than the tested version: `[{ id, title, version, tested }]`. */
export function lateModules(tested, installed) {
  const out = [];
  for ( const [id, min] of Object.entries(tested?.modules ?? {}) ) {
    const m = activeModule(installed, id);
    if ( m && (compareVersions(m.version, min) < 0) ) out.push({ id, title: m.title ?? id, version: m.version ?? "?", tested: min });
  }
  return out;
}

/**
 * Foundry, the system and the books against the tested versions: `[{ kind: "foundry" | "system" | "book", id?, title, version,
 * tested, way, level }]`, only what differs. A missing or inactive book is not a gap.
 */
export function compatibility(tested, installed) {
  const out = [];
  const add = (kind, title, version, wanted, id) => {
    const gap = (version && wanted) ? versionGap(version, wanted) : null;
    if ( gap ) out.push({ kind, id, title, version, tested: wanted, ...gap });
  };
  add("foundry", "Foundry VTT", installed?.foundry, tested?.foundry);
  add("system", "dnd5e", installed?.system, tested?.system);
  for ( const [id, wanted] of Object.entries(tested?.books ?? {}) ) {
    const m = activeModule(installed, id);
    if ( m ) add("book", m.title ?? id, m.version, wanted, id);
  }
  return out;
}

/**
 * A `when` condition: `{ module, min?, below? }` (this module is active, from `min`, before `below`) and / or
 * `{ system: "6.1.0" }` (the system from this version). No condition: always true.
 */
export function matches(when, installed) {
  if ( !when ) return true;
  if ( when.system && (compareVersions(installed?.system, when.system) < 0) ) return false;
  if ( when.module ) {
    const m = activeModule(installed, when.module);
    if ( !m ) return false;
    if ( when.min && (compareVersions(m.version, when.min) < 0) ) return false;
    if ( when.below && (compareVersions(m.version, when.below) >= 0) ) return false;
  }
  return true;
}

/** The risks written in these notes whose condition is met: `[{ id, version }]`, without duplicates. */
export function activeRisks(notes, installed) {
  return unique(notes.flatMap(n => (n.risks ?? []).filter(r => matches(r.when, installed)).map(r => ({ id: r.id, version: n.version }))));
}

/** The diagnostic checks recommended by these notes, in this world: `[{ id, version }]`, without duplicates. */
export function recommendedChecks(notes, installed) {
  return unique(notes.flatMap(n => (n.checks ?? []).filter(c => matches(c.when, installed)).map(c => ({ id: c.id, version: n.version }))));
}

function unique(list) {
  const seen = new Set();
  return list.filter(x => !seen.has(x.id) && seen.add(x.id));
}

/** Everything the window shows, at once. */
export function releaseReport(releases, { seen=null, current, installed={} }={}) {
  const notes = notesBetween(releases, { seen, current });
  const tested = testedFor(releases, current);
  return {
    current, seen, notes, tested,
    late: lateModules(tested, installed),
    compatibility: compatibility(tested, installed),
    risks: activeRisks(notes, installed),
    checks: recommendedChecks(notes, installed)
  };
}

/** Is there anything to say? (a version without a note and an up-to-date world: nothing opens.) */
export const hasNews = report => !!(report.notes.length || report.late.length || report.compatibility.length || report.risks.length);

/**
 * The safeguard: the flaws of the notes table, in plain words. `version` (that of `module.json`) must have its note.
 * @param {object[]} releases
 * @param {object} [options]
 * @param {string} [options.version]      The manifest's version.
 * @param {string[]} [options.checkIds]   The checks the diagnostic knows.
 */
export function validateReleases(releases, { version=null, checkIds=null }={}) {
  const problems = [];
  const ids = new Set();
  if ( !Array.isArray(releases) || !releases.length ) return ["aucune note de version"];
  for ( const r of releases ) {
    const at = `note ${r?.version ?? "?"}`;
    if ( !VERSION.test(r?.version ?? "") ) { problems.push(`${at} : version illisible`); continue; }
    if ( ids.has(r.version) ) problems.push(`${at} : en double`);
    ids.add(r.version);
    if ( !Array.isArray(r.highlights) || !r.highlights.length ) problems.push(`${at} : aucune nouveauté (highlights)`);
    for ( const h of r.highlights ?? [] ) if ( !/^[a-z][A-Za-z0-9]*$/.test(h) ) problems.push(`${at} : nouveauté « ${h} » mal nommée`);
    const t = r.tested;
    if ( !t || !VERSION.test(t.foundry ?? "") || !VERSION.test(t.system ?? "") ) problems.push(`${at} : versions testées de Foundry et du système manquantes (tested)`);
    for ( const [id, v] of [...Object.entries(t?.modules ?? {}), ...Object.entries(t?.books ?? {})] ) {
      if ( !VERSION.test(v ?? "") ) problems.push(`${at} : version testée de ${id} illisible`);
    }
    for ( const risk of r.risks ?? [] ) if ( !/^[a-z][A-Za-z0-9]*$/.test(risk?.id ?? "") ) problems.push(`${at} : risque sans id`);
    for ( const c of r.checks ?? [] ) {
      if ( !c?.id ) problems.push(`${at} : vérification sans id`);
      else if ( checkIds && !checkIds.includes(c.id) ) problems.push(`${at} : vérification « ${c.id} » inconnue du diagnostic`);
    }
  }
  const sorted = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  if ( releases.some((r, i) => r !== sorted[i]) ) problems.push("les notes ne sont pas rangées de la plus récente à la plus ancienne");
  if ( version && !ids.has(version) ) {
    problems.push(`la version ${version} de module/module.json n'a pas sa note de nouveautés → l'ajouter en tête de module/scripts/content/releases.mjs, avec ses textes dans module/lang/ (en, fr, pt-BR)`);
  }
  return problems;
}
