import { describe, expect, it } from "vitest";
import { brokenSourceLinks, failurePlace, sameData, withoutBrokenLinks } from "../module/scripts/core/source-links.mjs";

// Stand-in for Foundry's check: a document id is 16 letters or digits (common/data/validators.mjs, isValidId).
const isValid = v => /\.[a-zA-Z0-9]{16}$/.test(v);
const GOOD = "Compendium.dnd5e.items.Item.abcdefghijklmnop";
const BAD = "Compendium.world.old-import.Item.not-a-valid-id";

const actor = () => ({
  _id: "actor00000000001", name: "Ogre", _stats: { compendiumSource: null },
  items: [
    { _id: "item000000000001", name: "Club", _stats: { compendiumSource: GOOD } },
    { _id: "item000000000002", name: "Old axe", _stats: { compendiumSource: BAD, duplicateSource: null },
      effects: [{ _id: "eff0000000000001", name: "Sharp", _stats: { duplicateSource: BAD } }] }
  ],
  effects: [{ _id: "eff0000000000002", name: "Rage", _stats: { compendiumSource: GOOD } }]
});

describe("broken source links (§553)", () => {
  it("finds every link Foundry refuses, with where it sits", () => {
    expect(brokenSourceLinks(actor(), isValid)).toEqual([
      { path: ["items", "item000000000002"], name: "Old axe", field: "compendiumSource", value: BAD },
      { path: ["items", "item000000000002", "effects", "eff0000000000001"], name: "Sharp", field: "duplicateSource", value: BAD }
    ]);
    expect(brokenSourceLinks({ name: "x", _stats: { compendiumSource: BAD } }, isValid)).toHaveLength(1);
    expect(brokenSourceLinks({ name: "x" }, isValid)).toEqual([]);
    expect(brokenSourceLinks(null, isValid)).toEqual([]);
  });

  it("clears them in a copy, never in the original", () => {
    const data = actor();
    const { data: clean, removed } = withoutBrokenLinks(data, isValid);
    expect(removed).toHaveLength(2);
    expect(clean.items[1]._stats.compendiumSource).toBeNull();
    expect(clean.items[1].effects[0]._stats.duplicateSource).toBeNull();
    expect(clean.items[0]._stats.compendiumSource).toBe(GOOD);
    expect(data.items[1]._stats.compendiumSource).toBe(BAD);
    // A link the document still holds as is: left out of the write (its `_stats` dropped), not reported.
    const kept = withoutBrokenLinks(data, isValid, actor());
    expect(kept.removed).toEqual([]);
    expect(kept.data.items[1]._stats).toBeUndefined();
    expect(kept.data.items[1].effects[0]._stats).toBeUndefined();
    expect(kept.data.items[0]._stats.compendiumSource).toBe(GOOD);
    const changed = actor();
    changed.items[1]._stats.compendiumSource = null;
    expect(withoutBrokenLinks(data, isValid, changed).removed.map(l => l.field)).toEqual(["compendiumSource"]);
    const fine = { name: "y", items: [] };
    expect(withoutBrokenLinks(fine, isValid).data).toBe(fine);
  });

  it("names the actor and the item of an Adventure validation failure", () => {
    const data = { actors: [{ name: "A" }, { name: "Ogre", items: [{ name: "Club" }, { name: "Old axe" }] }] };
    expect(failurePlace("actors.1.items.1._stats.compendiumSource", data))
      .toEqual({ root: "Ogre", embedded: "Old axe", field: "_stats.compendiumSource" });
    expect(failurePlace("items.0.name", { items: [{ name: "Sword" }] })).toEqual({ root: "Sword", embedded: null, field: "name" });
    expect(failurePlace("actors.9.items.3.system", data)).toEqual({ root: "actors #9", embedded: "items #3", field: "system" });
    expect(failurePlace("name", data)).toEqual({ root: null, embedded: null, field: "name" });
  });

  it("compares data whatever the key order", () => {
    expect(sameData({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1, 2], [2, 1])).toBe(false);
    expect(sameData(null, null)).toBe(true);
    expect(sameData({}, [])).toBe(false);
  });
});
