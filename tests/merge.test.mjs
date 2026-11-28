import { describe, it, expect } from "vitest";
import { MERGE, mergeEntries } from "../module/scripts/core/content/merge.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";

/**
 * The layer merge (core/content/merge.mjs) follows a table: a schema key without a strategy would vanish silently at
 * merge time (a world or item entry would change nothing).
 */
describe("fusion des couches", () => {
  it("every schema key has its strategy, and the table has no other", () => {
    expect(Object.keys(MERGE).filter(k => !ENTRY_KEYS.includes(k))).toEqual([]);
    expect(ENTRY_KEYS.filter(k => !(k in MERGE))).toEqual([]);
  });
  it("the strategies: replace, merge field by field, copy", () => {
    const out = mergeEntries([
      { aura: { radius: 10, units: "ft" }, triggers: [{ on: "hit" }], recast: true, reactions: { perRound: 2 } },
      { aura: { radius: 30 }, triggers: { on: "isHit" }, recast: false },
      null
    ]);
    expect(out).toEqual({ triggers: [{ on: "isHit" }], aura: { radius: 30, units: "ft" }, recast: false, reactions: { perRound: 2 } });
  });
  it("a layer's keys come out in the table's order, whatever order the layer writes them in", () => {
    const [a, b, c] = Object.keys(MERGE);
    expect(Object.keys(mergeEntries([{ [c]: 1, [a]: 2, [b]: 3 }]))).toEqual([a, b, c]);
    // A more specific layer adds its keys at the end, and replaces those it takes up without moving them.
    const last = Object.keys(MERGE).at(-1);
    expect(Object.keys(mergeEntries([{ [last]: {}, [b]: 1 }, { [a]: 2, [b]: 4 }]))).toEqual([b, last, a]);
  });
  it("a key outside the schema, or named like an Object member, is ignored; no layer that has a say: null", () => {
    const a = "halfOnMiss";
    expect(mergeEntries([{ inconnue: 1, toString: 2, constructor: 3, __proto__: null, [a]: 5 }])).toEqual({ [a]: 5 });
    expect(mergeEntries([{ inconnue: 1 }])).toEqual({});
    expect(mergeEntries([null, undefined, {}, [], "x"])).toBe(null);
  });
});
