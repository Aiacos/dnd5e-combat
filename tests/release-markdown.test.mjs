/**
 * Issue #257: the release note of a version rendered as Markdown for its GitHub release page (tools/lib/release-markdown.mjs).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RELEASES } from "../module/scripts/content/releases.mjs";
import { findRelease, releaseMarkdown, describeWhen } from "../tools/lib/release-markdown.mjs";

const EN = JSON.parse(readFileSync(new URL("../module/lang/en.json", import.meta.url), "utf8"));
const MANIFEST = JSON.parse(readFileSync(new URL("../module/module.json", import.meta.url), "utf8"));

const LANG = {
  "DND5ECOMBAT.Nouveautes.NouveautesTitre": "What's new",
  "DND5ECOMBAT.Nouveautes.DiagnosticConseille": "Recommended checks:",
  "DND5ECOMBAT.Nouveautes.Point.a": "Point A.",
  "DND5ECOMBAT.Nouveautes.Point.b": "Point B for {who}.",
  "DND5ECOMBAT.Nouveautes.Risque.r.Titre": "Risk title.",
  "DND5ECOMBAT.Nouveautes.Risque.r.Texte": "Risk text.",
  "DND5ECOMBAT.Diagnostic.Verif.fix.Nom": "Fix things"
};
const NOTE = {
  version: "1.2.0",
  highlights: ["a", "b"],
  tested: { foundry: "14.370", system: "6.1.1", books: { "dnd-players-handbook": "3.0.0", "other-book": "1.0.0" },
    modules: { "darsh-loot": "0.22.6" } },
  risks: [{ id: "r", when: { module: "darsh-loot", below: "0.22.1" } }],
  checks: [{ id: "fix", when: { system: "6.1.0" } }]
};

describe("release note as Markdown", () => {
  it("renders highlights, risks, checks, tested versions and DAS modules", () => {
    const md = releaseMarkdown(NOTE, LANG);
    expect(md).toContain("## What's new\n\n- Point A.\n- Point B for {who}.");
    expect(md).toContain("- **Risk title** — Risk text. _Only when DAS · Loot & Trade is active (before 0.22.1)._");
    expect(md).toContain("Recommended checks:\n\n- Fix things _Only when dnd5e is 6.1.0 or later._");
    expect(md).toContain("- Foundry VTT 14.370\n- dnd5e 6.1.1\n- Player's Handbook (2024) 3.0.0\n- other-book 1.0.0");
    expect(md).toContain("| DAS · Loot & Trade | 0.22.6 |");
  });

  it("leaves out empty sections", () => {
    const md = releaseMarkdown({ version: "1.0.0", highlights: ["a"], tested: { foundry: "14", system: "6" }, risks: [], checks: [] }, LANG);
    expect(md).not.toMatch(/Compatibility risks|diagnostic|Other DAS modules/);
  });

  it("fails loudly on a missing text or a missing note", () => {
    expect(() => releaseMarkdown({ ...NOTE, highlights: ["absent"] }, LANG)).toThrow(/Point\.absent/);
    expect(() => releaseMarkdown(null, LANG)).toThrow();
    expect(findRelease(RELEASES, "99.0.0")).toBeNull();
  });

  it("describes conditions in plain words", () => {
    expect(describeWhen(null)).toBe("");
    expect(describeWhen({ module: "x", min: "1.0.0" })).toBe("Only when x is active (1.0.0 or later).");
    expect(describeWhen({ module: "x", min: "1", below: "2" })).toBe("Only when x is active (from 1, before 2).");
  });

  it("every shipped note renders, the current version included", () => {
    expect(findRelease(RELEASES, MANIFEST.version)).not.toBeNull();
    for ( const note of RELEASES ) expect(releaseMarkdown(note, EN)).toMatch(/^## /);
  });
});
