/**
 * Broken source links (§553): `_stats.compendiumSource` / `_stats.duplicateSource` values that Foundry no longer accepts.
 *
 * Foundry checks these fields as document UUIDs (common/data/fields.mjs:3545, `DocumentUUIDField#_validateType`): a UUID that parses
 * but whose document id is not 16 letters and digits fails with "must contain a valid document ID". A world can still hold such a
 * value (written by an older version, an importer or a module), and every copy of the document is then refused: the diagnostic's
 * backup (an Adventure) was refused whole for one item (Discord, "Diagnostic Repair Error", dnd5e 6.1.1, Core 0.293.0).
 *
 * Pure rules: the caller passes `isValid(value)`, which asks Foundry. Tested by tests/source-links.test.mjs.
 */

/** The `_stats` fields that hold a document UUID. */
export const SOURCE_FIELDS = Object.freeze(["compendiumSource", "duplicateSource"]);

/** The embedded collections walked, per level: a root's items and effects, an item's effects. */
const CHILDREN = Object.freeze({ root: ["items", "effects"], items: ["effects"], effects: [] });

/**
 * Every broken link of a document's data (its items and effects, and their effects, included).
 * @param {object} data                       Document data (`toObject()` or `_source`).
 * @param {(value: string) => boolean} isValid  True when Foundry accepts this UUID.
 * @returns {{ path: string[], name: string, field: string, value: string }[]}  `path`: the embedded ids from the root,
 *   e.g. `["items", "abc", "effects", "def"]` (empty for the root itself).
 */
export function brokenSourceLinks(data, isValid) {
  const out = [];
  const walk = (doc, path, level) => {
    if ( !doc || (typeof doc !== "object") ) return;
    for ( const field of SOURCE_FIELDS ) {
      const value = doc._stats?.[field];
      if ( (typeof value === "string") && value && !isValid(value) ) out.push({ path, name: doc.name ?? "", field, value });
    }
    for ( const child of CHILDREN[level] ?? [] ) {
      for ( const sub of Array.isArray(doc[child]) ? doc[child] : [] ) walk(sub, [...path, child, sub?._id], child);
    }
  };
  walk(data, [], "root");
  return out;
}

/** The document at this embedded path of some data (`[]`: the data itself). */
function atPath(data, path) {
  let doc = data;
  for ( let i = 0; i < path.length; i += 2 ) doc = (Array.isArray(doc?.[path[i]]) ? doc[path[i]] : []).find(d => d?._id === path[i + 1]);
  return doc ?? null;
}

/**
 * A copy of this data that Foundry will accept to write. A broken link the document still holds as is (`current`) is left alone: its
 * `_stats` is dropped from the write, so the stored value stays exactly. Any other broken link is set to null and reported in `removed`.
 * @param {object} data                         The data to write.
 * @param {(value: string) => boolean} isValid
 * @param {object|null} [current]               The document's data as it is now (same root as `data`).
 * @returns {{ data: object, removed: { path: string[], name: string, field: string, value: string }[] }}
 */
export function withoutBrokenLinks(data, isValid, current=null) {
  const links = brokenSourceLinks(data, isValid);
  if ( !links.length ) return { data, removed: [] };
  const copy = structuredClone(data);
  const removed = [];
  for ( const link of links ) {
    const doc = atPath(copy, link.path);
    if ( !doc?._stats ) continue;
    if ( current && (atPath(current, link.path)?._stats?.[link.field] === link.value) ) delete doc._stats;
    else { doc._stats[link.field] = null; removed.push(link); }
  }
  return { data: copy, removed };
}

/**
 * Where a validation failure of an Adventure sits, in words: which actor or item, which embedded item or effect, which field.
 * Foundry names an array element by its index (`DataModelValidationFailure#getAllFailures`, common/data/validation-failure.mjs:203),
 * e.g. `actors.41.items.33._stats.compendiumSource`.
 * @param {string} path                                 The failure path.
 * @param {{ actors?: object[], items?: object[] }} data  The Adventure data that was refused.
 * @returns {{ root: string|null, embedded: string|null, field: string }}
 */
export function failurePlace(path, data) {
  const parts = String(path ?? "").split(".");
  let root = null;
  let embedded = null;
  let rest = parts;
  if ( ["actors", "items"].includes(parts[0]) && /^\d+$/.test(parts[1] ?? "") ) {
    const doc = data?.[parts[0]]?.[Number(parts[1])];
    root = doc?.name ?? `${parts[0]} #${parts[1]}`;
    rest = parts.slice(2);
    if ( ["items", "effects"].includes(rest[0]) && /^\d+$/.test(rest[1] ?? "") ) {
      const sub = doc?.[rest[0]]?.[Number(rest[1])];
      embedded = sub?.name ?? `${rest[0]} #${rest[1]}`;
      rest = rest.slice(2);
    }
  }
  return { root, embedded, field: rest.join(".") };
}

/** Do two plain data objects hold the same values (key order ignored)? Used to leave an untouched embedded document alone. */
export function sameData(a, b) {
  if ( a === b ) return true;
  if ( (typeof a !== "object") || (typeof b !== "object") || !a || !b ) return false;
  if ( Array.isArray(a) !== Array.isArray(b) ) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if ( ka.length !== kb.length ) return false;
  return ka.every(k => Object.hasOwn(b, k) && sameData(a[k], b[k]));
}
