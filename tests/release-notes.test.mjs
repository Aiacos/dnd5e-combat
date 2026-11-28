/**
 * §439: the update message. Two things held here:
 *  - the RELEASE GUARD: the version of `module/module.json` has its note in `content/releases.mjs`, every novelty and every
 *    risk has its text in the three languages, every recommended check exists in the diagnostic;
 *  - the pure rules of `core/release-notes.mjs` (which notes to show, outdated modules, version gaps, conditions).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RELEASES } from "../module/scripts/content/releases.mjs";
import {
  compareVersions, versionGap, notesBetween, testedFor, lateModules, compatibility, matches, activeRisks, recommendedChecks,
  releaseReport, hasNews, validateReleases
} from "../module/scripts/core/release-notes.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const MANIFEST = JSON.parse(read("module/module.json"));
const LANGS = Object.fromEntries(["en", "fr", "pt-BR"].map(l => [l, JSON.parse(read(`module/lang/${l}.json`))]));
const CHECK_IDS = [...read("module/scripts/runtime/diagnostic/checks.mjs").matchAll(/^\s*id: "([a-z0-9-]+)"/gm)].map(m => m[1]);

describe("garde-fou de release : les notes de version", () => {
  it("the module.json version has its release note, and the table is sound", () => {
    expect(CHECK_IDS.length).toBeGreaterThan(5);
    expect(validateReleases(RELEASES, { version: MANIFEST.version, checkIds: CHECK_IDS })).toEqual([]);
  });

  it("every novelty, risk and check has its text in en, fr and pt-BR", () => {
    const missing = [];
    for ( const r of RELEASES ) {
      const keys = [
        ...r.highlights.map(id => `DND5ECOMBAT.Nouveautes.Point.${id}`),
        ...(r.risks ?? []).flatMap(x => [`DND5ECOMBAT.Nouveautes.Risque.${x.id}.Titre`, `DND5ECOMBAT.Nouveautes.Risque.${x.id}.Texte`]),
        ...(r.checks ?? []).map(c => `DND5ECOMBAT.Diagnostic.Verif.${c.id}.Nom`)
      ];
      for ( const [lang, table] of Object.entries(LANGS) ) {
        for ( const key of keys ) if ( !table[key] ) missing.push(`${lang}.json « ${key} » (note ${r.version})`);
      }
    }
    expect(missing, "textes manquants dans module/lang/").toEqual([]);
  });

  it("no novelty text without a note that cites it", () => {
    const used = new Set(RELEASES.flatMap(r => [...r.highlights.map(id => `Point.${id}`), ...(r.risks ?? []).map(x => `Risque.${x.id}`)]));
    const orphans = Object.keys(LANGS.en).map(k => /^DND5ECOMBAT\.Nouveautes\.((?:Point|Risque)\.[A-Za-z0-9]+)/.exec(k)?.[1])
      .filter(k => k && !used.has(k));
    expect(orphans).toEqual([]);
  });

  it("the notes' French does not use the pronoun \"on\"", () => {
    const bad = Object.entries(LANGS.fr).filter(([k, v]) => k.startsWith("DND5ECOMBAT.Nouveautes.") && /(^|[\s'’(«])on\s/i.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("the guard speaks up when a version has no note", () => {
    expect(validateReleases(RELEASES, { version: "99.0.0" }).join("\n")).toMatch(/99\.0\.0.*n'a pas sa note/);
    expect(validateReleases([{ version: "1.0.0", highlights: [], tested: { foundry: "14.370", system: "6.1.0" } }])).toHaveLength(1);
    expect(validateReleases([{ version: "1.0.0", highlights: ["a"], tested: { foundry: "14.370", system: "6.1.0" }, checks: [{ id: "inconnue" }] }],
      { checkIds: ["connue"] })[0]).toMatch(/inconnue du diagnostic/);
    const two = [{ version: "1.0.0", highlights: ["a"], tested: { foundry: "14", system: "6.1.0" } }, { version: "1.1.0", highlights: ["b"], tested: { foundry: "14", system: "6.1.0" } }];
    expect(validateReleases(two)[0]).toMatch(/plus récente à la plus ancienne/);
  });
});

const NOTES = [
  { version: "0.3.0", highlights: ["c"], tested: { foundry: "14.370", system: "6.1.0", books: { livre: "3.0.0" }, modules: { voisin: "0.5.0", autre: "1.2.0" } },
    risks: [{ id: "fiches", when: { module: "livre", min: "3.0.0" } }, { id: "toujours" }],
    checks: [{ id: "reparer", when: { module: "livre", min: "3.0.0" } }, { id: "marques", when: { system: "6.1.0" } }] },
  { version: "0.2.1", highlights: ["b"], tested: { foundry: "14.370", system: "6.0.6" }, checks: [{ id: "reparer" }] },
  { version: "0.2.0", highlights: ["a"], tested: { foundry: "14.360", system: "6.0.6" } }
];
const world = (over={}) => ({
  foundry: "14.370", system: "6.1.0",
  modules: [{ id: "voisin", title: "Voisin", version: "0.5.0", active: true }, { id: "autre", title: "Autre", version: "1.2.0", active: true },
    { id: "livre", title: "Le Livre", version: "3.0.0", active: true }],
  ...over
});

describe("update message rules", () => {
  it("compare les versions nombre par nombre", () => {
    expect(compareVersions("0.283.0", "0.282.1")).toBeGreaterThan(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("14.370", "14.370")).toBe(0);
    expect(compareVersions("6.1", "6.1.0")).toBe(0);
  });

  it("the notes of the versions released since the last one seen, most recent first", () => {
    expect(notesBetween(NOTES, { seen: "0.2.0", current: "0.3.0" }).map(n => n.version)).toEqual(["0.3.0", "0.2.1"]);
    expect(notesBetween(NOTES, { seen: "0.1.0", current: "0.2.1" }).map(n => n.version)).toEqual(["0.2.1", "0.2.0"]);
    expect(notesBetween(NOTES, { seen: "0.3.0", current: "0.3.0" })).toEqual([]);
    // Manual opening: the latest ones, never a note newer than the installed module.
    expect(notesBetween(NOTES, { current: "0.2.1", limit: 5 }).map(n => n.version)).toEqual(["0.2.1", "0.2.0"]);
    expect(testedFor(NOTES, "0.2.5").system).toBe("6.0.6");
  });

  it("active modules older than the tested version", () => {
    const installed = world({ modules: [{ id: "voisin", title: "Voisin", version: "0.4.9", active: true }, { id: "autre", title: "Autre", version: "1.0.0", active: false }] });
    expect(lateModules(NOTES[0].tested, installed)).toEqual([{ id: "voisin", title: "Voisin", version: "0.4.9", tested: "0.5.0" }]);
    expect(lateModules(NOTES[0].tested, world())).toEqual([]);
    expect(lateModules(NOTES[1].tested, world())).toEqual([]);
  });

  it("the gap of one version from the tested version: patch = info, beyond = alert", () => {
    expect(versionGap("6.1.0", "6.1.0")).toBeNull();
    expect(versionGap("6.1.2", "6.1.0")).toEqual({ way: "newer", level: "info" });
    expect(versionGap("6.0.6", "6.1.0")).toEqual({ way: "older", level: "warn" });
    expect(versionGap("14.371", "14.370")).toEqual({ way: "newer", level: "info" });
    expect(versionGap("15.380", "14.370")).toEqual({ way: "newer", level: "warn" });
  });

  it("Foundry, the system and the installed books against the tested versions", () => {
    expect(compatibility(NOTES[0].tested, world())).toEqual([]);
    const old = world({ system: "6.0.6", modules: [{ id: "livre", title: "Le Livre", version: "2.2.0", active: true }] });
    expect(compatibility(NOTES[0].tested, old).map(g => [g.kind, g.way, g.level])).toEqual([["system", "older", "warn"], ["book", "older", "warn"]]);
    // A missing or inactive book is not a gap.
    expect(compatibility(NOTES[0].tested, world({ modules: [{ id: "livre", version: "2.2.0", active: false }] }))).toEqual([]);
  });

  it("conditions: module active from a version, before a version, system", () => {
    expect(matches(null, world())).toBe(true);
    expect(matches({ module: "livre", min: "3.0.0" }, world())).toBe(true);
    expect(matches({ module: "livre", below: "3.0.0" }, world())).toBe(false);
    expect(matches({ module: "absent" }, world())).toBe(false);
    expect(matches({ system: "6.1.0" }, world({ system: "6.0.6" }))).toBe(false);
  });

  it("risks and recommended checks, without duplicates, by world", () => {
    const notes = notesBetween(NOTES, { seen: "0.2.0", current: "0.3.0" });
    expect(activeRisks(notes, world()).map(r => r.id)).toEqual(["fiches", "toujours"]);
    expect(recommendedChecks(notes, world()).map(c => c.id)).toEqual(["reparer", "marques"]);
    const sansLivre = world({ system: "6.0.6", modules: [] });
    expect(activeRisks(notes, sansLivre).map(r => r.id)).toEqual(["toujours"]);
    expect(recommendedChecks(notes, sansLivre).map(c => c.id)).toEqual(["reparer"]);
  });

  it("the full report, and whether there is anything to say", () => {
    const report = releaseReport(NOTES, { seen: "0.2.1", current: "0.3.0", installed: world() });
    expect(report.notes.map(n => n.version)).toEqual(["0.3.0"]);
    expect(hasNews(report)).toBe(true);
    expect(hasNews(releaseReport([], { seen: "0.1.0", current: "0.2.0", installed: world() }))).toBe(false);
  });

  it("the shipped note of the next version: Manual 3.0.0 brings its risk and its two checks", () => {
    const next = RELEASES[0];
    const installed = { foundry: next.tested.foundry, system: next.tested.system,
      modules: [{ id: "dnd-players-handbook", title: "PHB", version: "3.0.0", active: true }] };
    const report = releaseReport(RELEASES, { seen: RELEASES[1]?.version ?? "0.0.1", current: next.version, installed });
    if ( next.version === "0.283.0" ) {
      expect(report.risks.map(r => r.id)).toEqual(["phb3Fiches"]);
      expect(report.checks.map(c => c.id)).toEqual(["phb3-subclasses", "phb3-items", "modify-item", "data-fixes", "magical-effects", "spell-duplicates"]);
      expect(report.compatibility).toEqual([]);
    }
  });
});
