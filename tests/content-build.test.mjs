import { describe, it, expect } from "vitest";
import { BRICKS, ENTRY_TABLES } from "../module/scripts/content/index.mjs";
import { MERGE } from "../module/scripts/core/content/merge.mjs";

/**
 * The shipped content is made of per-brick tables, then entry tables (content/index.mjs). Two writes of the same key
 * for the same identifier are not seen: the second replaces the first. Only field-by-field merging (`shallow`) is
 * allowed between two tables; everything else must be declared in a single place.
 */
describe("composition of the shipped content", () => {
  const writes = [];
  for ( const [source, key] of BRICKS ) {
    const ids = Array.isArray(source) ? source : Object.keys(source);
    for ( const id of ids ) for ( const k of (key ? [key] : Object.keys(source[id])) ) writes.push({ id, key: k, from: "brique" });
  }
  ENTRY_TABLES.forEach((table, i) => {
    for ( const [id, entry] of Object.entries(table) ) for ( const k of Object.keys(entry) ) writes.push({ id, key: k, from: `table ${i}` });
  });

  it("no key written twice for the same identifier (apart from field-by-field merging)", () => {
    const seen = new Map();
    const twice = [];
    for ( const w of writes ) {
      const tag = `${w.id}.${w.key}`;
      if ( seen.has(tag) && (MERGE[w.key] !== "shallow") ) twice.push(`${tag} : ${seen.get(tag)} puis ${w.from}`);
      seen.set(tag, w.from);
    }
    expect(twice).toEqual([]);
  });
});
