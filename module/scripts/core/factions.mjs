/**
 * §181: factions — who is whose enemy, beyond the token's disposition.
 *
 * A "side" is what the adapter knows of a token: `{ disposition, faction, uuid, stance }`. The relation between two
 * sides comes from the faction table (world setting + scene grudges) when **both** have a faction and the
 * table says something about that pair; otherwise each rule keeps exactly its previous comparison of dispositions. So a
 * world without factions, or a pair that the table leaves at "follow the disposition", changes nothing.
 *
 * The table is injected by the adapter (`useFactionTable`), like randomness: the core reads no setting.
 */

import { relationOf } from "./targeting.mjs";

/** Are two dispositions opposed (Friendly vs Hostile)? A neutral (0) or a secret (-2) neither provokes nor suffers anything. */
export function areHostile(a, b) {
  return ((a === 1) && (b === -1)) || ((a === -1) && (b === 1));
}

/** The implicit faction of PCs and of what a player owns. */
export const PARTY = "party";

/** The three relations a matrix cell can carry; absent = follow the disposition. */
export const RELATIONS = Object.freeze(["hostile", "neutral", "allied"]);

/**
 * Suggested generic factions (public repository: by creature type, no creature name). The name is translated by
 * `DCOMBAT.Factions.Generic.<id>`. They apply only if the GM keeps the per-type rules (`factionRules` setting).
 */
export const GENERIC_FACTIONS = Object.freeze([
  { id: "wildlife", color: "#6b8e23", rules: { types: ["beast"] } },
  { id: "undead", color: "#5b4b8a", rules: { types: ["undead"] } },
  { id: "aberrations", color: "#8a2b6b", rules: { types: ["aberration"] } },
  { id: "fiends", color: "#a52a2a", rules: { types: ["fiend"] } },
  { id: "monstrosities", color: "#8b5a2b", rules: { types: ["monstrosity"] } },
  { id: "oozes", color: "#3c8d6e", rules: { types: ["ooze"] } },
  { id: "plants", color: "#2e7d32", rules: { types: ["plant"] } }
]);

/**
 * Suggested relations between generic factions (matrix button, never applied by default): the Undead,
 * aberrations and fiends hate everything that is not themselves; the rest ignore each other.
 */
const HATERS = new Set(["undead", "aberrations", "fiends"]);

const EMPTY = Object.freeze({ factions: [], relations: {}, grudges: [] });
let TABLE = EMPTY;

/** The key of a pair, independent of order. */
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A faction id: letters, digits, hyphens; not empty. */
export function validFactionId(id) {
  return (typeof id === "string") && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(id);
}

/**
 * Put back in order what the setting contains (the GM, an import, an old version): valid and unique factions, known relations
 * between known factions, `party` always present at the head.
 * @param {object} raw
 * @returns {{factions: object[], relations: Object<string, string>}}
 */
export function normalizeFactions(raw) {
  const seen = new Set([PARTY]);
  const factions = [{ id: PARTY, name: "", color: "#3a7bd5", rules: {}, ...(raw?.factions ?? []).find(f => f?.id === PARTY), id: PARTY }];
  for ( const f of raw?.factions ?? [] ) {
    if ( !f || !validFactionId(f.id) || seen.has(f.id) ) continue;
    seen.add(f.id);
    const rules = {};
    for ( const k of ["types", "subtypes", "identifiers"] ) {
      const list = (f.rules?.[k] ?? []).filter(v => (typeof v === "string") && v.trim()).map(v => v.trim().toLowerCase());
      if ( list.length ) rules[k] = [...new Set(list)];
    }
    factions.push({ id: f.id, name: String(f.name ?? ""), color: /^#[0-9a-f]{6}$/i.test(f.color ?? "") ? f.color : "#888888", rules });
  }
  const relations = {};
  for ( const [key, value] of Object.entries(raw?.relations ?? {}) ) {
    const [a, b] = key.split("|");
    if ( !seen.has(a) || !seen.has(b) || (a === b) || !RELATIONS.includes(value) ) continue;
    relations[pairKey(a, b)] = value;
  }
  return { factions, relations };
}

/** The suggested relations for these factions (§181): to merge under those the GM has already set. */
export function suggestedRelations(factions) {
  const ids = factions.map(f => f.id).filter(id => id !== PARTY);
  const out = {};
  for ( const a of ids ) for ( const b of ids ) {
    if ( a >= b ) continue;
    out[pairKey(a, b)] = (HATERS.has(a) || HATERS.has(b)) ? "hostile" : "neutral";
  }
  return out;
}

/**
 * The faction that a rule gives a creature, from its facts (type, subtype, actor identifier): the first that
 * matches, in list order; an identifier wins over a subtype, which wins over a type.
 * @param {object[]} factions
 * @param {{type?: string, subtype?: string, identifier?: string}} facts
 * @returns {string|null}
 */
export function factionByRules(factions, { type, subtype, identifier }={}) {
  const low = v => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const subtypes = low(subtype).split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
  for ( const key of ["identifiers", "subtypes", "types"] ) {
    for ( const f of factions ) {
      if ( f.id === PARTY ) continue;
      const list = f.rules?.[key] ?? [];
      if ( !list.length ) continue;
      if ( (key === "identifiers") && identifier && list.includes(low(identifier)) ) return f.id;
      if ( (key === "subtypes") && subtypes.some(s => list.includes(s)) ) return f.id;
      if ( (key === "types") && type && list.includes(low(type)) ) return f.id;
    }
  }
  return null;
}

/**
 * The table that the core consults. `relations`: `pairKey` key → relation; `grudges`: `[a, b]` pairs of faction ids or
 * token uuids that became hostile on the scene (grudge). Called by the adapter on each change.
 */
export function useFactionTable(table) {
  TABLE = table ? { factions: table.factions ?? [], relations: table.relations ?? {}, grudges: table.grudges ?? [] } : EMPTY;
}

/** La table en cours (tests, API). */
export function factionTable() {
  return TABLE;
}

/** Does a grudge link these two sides? By faction or by token. */
function grudged(a, b, grudges) {
  if ( !grudges.length ) return false;
  const ids = s => [s.faction, s.uuid ?? ((typeof s.token === "string") ? s.token : null)].filter(Boolean);
  const idsA = ids(a), idsB = ids(b);
  return grudges.some(([x, y]) => (idsA.includes(x) && idsB.includes(y)) || (idsA.includes(y) && idsB.includes(x)));
}

/**
 * The factions' relation between two sides, or null when it says nothing (the disposition must then be followed).
 * @param {{faction?: string|null, uuid?: string|null, stance?: string|null}} a
 * @param {typeof a} b
 * @param {object} [table]
 * @returns {"hostile"|"neutral"|"allied"|null}
 */
export function factionRelation(a, b, table=TABLE) {
  if ( !a || !b ) return null;
  const same = !!a.faction && (a.faction === b.faction);
  if ( grudged(a, b, table.grudges ?? []) ) return "hostile";
  // A creature that has surrendered (darsh-npc, morale) is nobody's enemy outside its faction.
  if ( !same && ((a.stance === "neutral") || (b.stance === "neutral")) ) return "neutral";
  if ( !a.faction || !b.faction ) return null;
  if ( same ) return a.faction === PARTY ? null : "allied";
  const value = table.relations?.[pairKey(a.faction, b.faction)];
  return RELATIONS.includes(value) ? value : null;
}

/** Ennemis ? Sans relation de faction : Amical contre Hostile, comme `areHostile`. */
export function hostileSides(a, b) {
  const r = factionRelation(a, b);
  return r ? r === "hostile" : areHostile(a?.disposition, b?.disposition);
}

/**
 * §479: one Neutral (0), the other Friendly or Hostile, with no faction relation between them — the case where a "between opposing
 * sides" rule (Opportunity Attack) does not trigger and surprises: a monster that stayed Neutral.
 */
export function neutralFacing(a, b) {
  if ( factionRelation(a, b) ) return false;
  const da = a?.disposition, db = b?.disposition;
  return ((da === 0) && (Math.abs(db) === 1)) || ((db === 0) && (Math.abs(da) === 1));
}

/** Same side? Without a faction relation: same disposition. */
export function alliedSides(a, b) {
  const r = factionRelation(a, b);
  return r ? r === "allied" : (a?.disposition === b?.disposition);
}

/**
 * For targeting (`targeting.mjs` `relationOf`): "same", "opposed" or "neutral". Without a faction relation, the previous
 * rule on dispositions (a neutral or a secret: "neutral").
 */
export function targetRelation(a, b) {
  const r = factionRelation(a, b);
  if ( !r ) return relationOf(a?.disposition, b?.disposition);
  return r === "allied" ? "same" : (r === "hostile" ? "opposed" : "neutral");
}

/** The disposition that an explicit relation with the PCs imposes (1, 0, -1), or null when it follows the token. */
export function dispositionFor(faction, table=TABLE) {
  if ( !faction || (faction === PARTY) ) return null;
  const value = table.relations?.[pairKey(faction, PARTY)];
  return { hostile: -1, neutral: 0, allied: 1 }[value] ?? null;
}
