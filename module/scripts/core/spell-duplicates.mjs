/**
 * The duplicate spells of a sheet (`spell-duplicates` diagnostic check, user request 2026-11-15).
 *
 * A spell-preparation module that recognizes a spell by the uuid of its source compendium (`_stats.compendiumSource`) does not
 * recognize the same spell coming from another compendium (SRD 5.2 `dnd5e.spells24` versus Player's Handbook): it adds a second
 * copy, and the sheet carries the same spell twice. Seen on the test bench on 2026-11-15: unprepared SRD Guiding Bolt +
 * prepared Handbook copy.
 *
 * A duplicate: same dnd5e identifier, same origin (class — `classIdentifier`, or "class:<id>" of `system.sourceItem` —, or the item
 * that granted it), same method. Never duplicates: innate, at-will or "ritual only" spells (methods `innate`,
 * `atwill`, `ritual`, which legitimately exist alongside the class spell) and the copy an item casts (`flags.dnd5e.cachedFor`).
 * The spell kept: the one from the preferred compendium (order of `preferred`), then the most prepared, then the one carrying
 * the most module settings, then the first on the sheet. It takes the highest preparation state of the group and the flag
 * scopes that only the removed spells carried (apart from `skipFlags`).
 *
 * Pure: receives plain descriptions, no Foundry document.
 */

/** Methods by which a spell can exist in addition to the class spell. */
export const SIDE_METHODS = Object.freeze(["innate", "atwill", "ritual"]);

/** Flag scopes that do not pass from a removed spell to the kept one (specific to each copy, or to the system). */
export const SKIP_FLAGS = Object.freeze(["core", "dnd5e", "babele", "exportSource"]);

/**
 * The origin of a spell for grouping: "class:<id>", another written origin ("subclass:life", an item), or, failing that,
 * the sheet's only caster class (`casterClasses`), otherwise "".
 * @param {{classIdentifier?: string, sourceItem?: string}} spell
 * @param {string[]} [casterClasses]
 */
export function originKey({ classIdentifier="", sourceItem="" }={}, casterClasses=[]) {
  const written = String(sourceItem ?? "");
  const cls = classIdentifier || (written.startsWith("class:") ? written.slice(6) : "");
  if ( cls ) return `class:${cls}`;
  if ( written ) return written;
  return (casterClasses.length === 1) ? `class:${casterClasses[0]}` : "";
}

/** Rank of an origin uuid in the list of preferred compendiums (prefixes); beyond that: none. */
function sourceRank(source, preferred) {
  const i = preferred.findIndex(p => String(source ?? "").startsWith(p));
  return (i < 0) ? preferred.length : i;
}

/**
 * The duplicate groups of a sheet.
 * @param {Array<{id: string, name?: string, identifier?: string, method?: string, prepared?: number, classIdentifier?: string,
 *   sourceItem?: string, source?: string, cachedFor?: string|null, flagScopes?: string[], sort?: number}>} spells
 * @param {{casterClasses?: string[], preferred?: string[], skipFlags?: string[]}} [options]
 * @returns {Array<{keep: object, remove: object[], prepared: number, raisePrepared: boolean, flagScopes: string[]}>}
 *   `flagScopes`: the flag scopes to copy from a removed spell to the kept one, with the id of the spell that provides them
 *   (`[{ scope, from }]`).
 */
export function spellDuplicates(spells, { casterClasses=[], preferred=[], skipFlags=SKIP_FLAGS }={}) {
  const groups = new Map();
  for ( const spell of spells ?? [] ) {
    if ( SIDE_METHODS.includes(spell.method) || spell.cachedFor ) continue;
    const identifier = spell.identifier || String(spell.name ?? "").toLowerCase();
    if ( !identifier ) continue;
    const key = `${identifier}|${originKey(spell, casterClasses)}|${spell.method ?? ""}`;
    if ( !groups.has(key) ) groups.set(key, []);
    groups.get(key).push(spell);
  }
  const out = [];
  for ( const group of groups.values() ) {
    if ( group.length < 2 ) continue;
    const ranked = [...group].sort((a, b) => (sourceRank(a.source, preferred) - sourceRank(b.source, preferred))
      || ((Number(b.prepared) || 0) - (Number(a.prepared) || 0))
      || ((b.flagScopes?.length ?? 0) - (a.flagScopes?.length ?? 0))
      || ((a.sort ?? 0) - (b.sort ?? 0)));
    const [keep, ...remove] = ranked;
    const prepared = Math.max(...group.map(s => Number(s.prepared) || 0));
    const kept = new Set(keep.flagScopes ?? []);
    const flagScopes = [];
    for ( const r of remove ) for ( const scope of r.flagScopes ?? [] ) {
      if ( skipFlags.includes(scope) || kept.has(scope) ) continue;
      kept.add(scope);
      flagScopes.push({ scope, from: r.id });
    }
    out.push({ keep, remove, prepared, raisePrepared: prepared > (Number(keep.prepared) || 0), flagScopes });
  }
  return out;
}
