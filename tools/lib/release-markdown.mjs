/**
 * Issue #257: the release note of one version (module/scripts/content/releases.mjs, §439) rendered as Markdown for the body of
 * its GitHub release. Pure: the caller hands the note, the English lang table and the display names; nothing is read here.
 */

/** Display names of the ids a note's `tested` block lists. An id missing here is shown as is. */
export const DISPLAY_NAMES = Object.freeze({
  "dnd-players-handbook": "Player's Handbook (2024)",
  "dnd-monster-manual": "Monster Manual (2024)",
  "dnd-dungeon-masters-guide": "Dungeon Master's Guide (2024)",
  "dnd-ravenloft-horrors-within": "Ravenloft: The Horrors Within",
  "darsh-dnd-ui": "DAS · Combat UI",
  "darsh-loot": "DAS · Loot & Trade",
  "dnd5e-lumiere": "DAS · Shadows & Ambience",
  "darsh-animations": "DAS · Animations",
  "darsh-homebrew": "DAS · Homebrew",
  "darsh-npc": "DAS · Automated NPC",
  "darsh-controller": "DAS · Controller"
});

const PREFIX = "DND5ECOMBAT.";

/** Finds the note of `version`, or null. */
export function findRelease(releases, version) {
  return releases.find(r => r.version === version) ?? null;
}

/** The text of a lang key, `{name}` placeholders filled; throws on a missing key so a release never ships a raw key. */
function text(lang, key, data = {}) {
  const value = lang[PREFIX + key];
  if ( typeof value !== "string" || !value ) throw new Error(`missing English text « ${PREFIX + key} »`);
  return value.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m));
}

/** A `when` condition in plain words, or "" when there is none. */
export function describeWhen(when, names = DISPLAY_NAMES) {
  if ( !when ) return "";
  const parts = [];
  if ( when.module ) {
    let s = `${names[when.module] ?? when.module} is active`;
    if ( when.min && when.below ) s += ` (from ${when.min}, before ${when.below})`;
    else if ( when.min ) s += ` (${when.min} or later)`;
    else if ( when.below ) s += ` (before ${when.below})`;
    parts.push(s);
  }
  if ( when.system ) parts.push(`dnd5e is ${when.system} or later`);
  return parts.length ? `Only when ${parts.join(" and ")}.` : "";
}

/**
 * The Markdown body of a note.
 * @param {object} note     one entry of RELEASES
 * @param {object} lang     module/lang/en.json, parsed
 * @param {object} [names]  display names of module ids
 * @returns {string}
 */
export function releaseMarkdown(note, lang, names = DISPLAY_NAMES) {
  if ( !note ) throw new Error("no release note");
  const name = id => names[id] ?? id;
  const out = [];

  out.push(`## ${text(lang, "Nouveautes.NouveautesTitre")}`, "");
  for ( const id of note.highlights ?? [] ) out.push(`- ${text(lang, `Nouveautes.Point.${id}`)}`);
  out.push("");

  const risks = note.risks ?? [];
  if ( risks.length ) {
    out.push("## Compatibility risks", "");
    for ( const r of risks ) {
      const when = describeWhen(r.when, names);
      const title = text(lang, `Nouveautes.Risque.${r.id}.Titre`).replace(/[.:]\s*$/, "");
      out.push(`- **${title}** — ${text(lang, `Nouveautes.Risque.${r.id}.Texte`)}${when ? ` _${when}_` : ""}`);
    }
    out.push("");
  }

  const checks = note.checks ?? [];
  if ( checks.length ) {
    out.push("## Recommended World diagnostic checks", "", text(lang, "Nouveautes.DiagnosticConseille"), "");
    for ( const c of checks ) {
      const when = describeWhen(c.when, names);
      out.push(`- ${text(lang, `Diagnostic.Verif.${c.id}.Nom`)}${when ? ` _${when}_` : ""}`);
    }
    out.push("");
  }

  const tested = note.tested ?? {};
  out.push("## Tested with", "");
  out.push(`- Foundry VTT ${tested.foundry}`, `- dnd5e ${tested.system}`);
  for ( const [id, v] of Object.entries(tested.books ?? {}) ) out.push(`- ${name(id)} ${v}`);
  out.push("");

  const modules = Object.entries(tested.modules ?? {});
  if ( modules.length ) {
    out.push("## Other DAS modules", "", `DAS · Core ${note.version} was tested with these versions or later:`, "");
    out.push("| Module | Version |", "| --- | --- |");
    for ( const [id, v] of modules ) out.push(`| ${name(id)} | ${v} |`);
    out.push("");
  }

  return out.join("\n");
}
