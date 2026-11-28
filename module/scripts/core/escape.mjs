/**
 * Escaping through a check (SPEC §16.54): "a Restrained creature can take an action to make a Strength (Athletics) check
 * against your spell save DC" — Entangle, Ensnaring Strike, Evard's Black Tentacles; the kuo-toa's "Sticky Net", Absorb,
 * Engulf in the Monster Manual. The check is written in the item's text, as a dnd5e enricher:
 *
 *   [[/check ability=str skill=ath dc=@attributes.spell.dc]]   (PHB spells)
 *   [[/check ath dc=@skills.ath.passive format=long]]           (Monster Manual)
 *   [[/skill ath 10]]
 *
 * Enricher form: dnd5e 6.0.3, `parseConfig` and `enrichCheck` (dnd5e.mjs:32003-32016, :32383) — pairs
 * `clé=valeur` or bare values, sorted by what they are (ability, skill, number = DC).
 */

const ENRICHER = /\[\[\/(check|skill)\s+([^\]]*)\]\]/i;

/**
 * The first check of a text, or null.
 * @param {string} text
 * @param {{abilities: string[], skills: string[], defaultDc?: string|null}} known  keys of `CONFIG.DND5E.abilities` / `.skills`;
 *   `defaultDc`: the DC of a check written without a DC — the caster's spell DC for a spell ("against your spell save
 *   DC"), which imported texts (DDB Importer: `[[/check str format=long]]`) do not put in the enricher. Without it,
 *   a check without a DC stays unreadable.
 * @returns {{ability: string|null, skill: string|null, dc: string}|null}  `dc`: number or formula (`@attributes.spell.dc`)
 */
export function parseEscapeCheck(text, { abilities=[], skills=[], defaultDc=null }={}) {
  const m = String(text ?? "").match(ENRICHER);
  if ( !m ) return null;
  const out = { ability: null, skill: null, dc: null };
  for ( const token of m[2].trim().split(/\s+/) ) {
    const [key, value] = token.includes("=") ? token.split("=", 2) : [null, token];
    const v = value.toLowerCase();
    if ( key === "ability" ) out.ability = v;
    else if ( key === "skill" ) out.skill = v.split(/[,|]/)[0];
    else if ( key === "dc" ) out.dc = value;
    else if ( key ) continue;   // format=long, passive…
    else if ( /^\d+$/.test(v) ) out.dc = v;
    else if ( skills.includes(v) ) out.skill = v;
    else if ( abilities.includes(v) ) out.ability = v;
  }
  out.dc ??= defaultDc;
  if ( !out.dc || (!out.ability && !out.skill) ) return null;
  return out;
}

/** The effects one escapes through this check: Restrained, without Grappled (a grapple has its own Escape). */
export const escapableStatuses = statuses => statuses.includes("restrained") && !statuses.includes("grappled");
