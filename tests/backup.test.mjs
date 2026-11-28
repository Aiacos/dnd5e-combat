import { describe, expect, it } from "vitest";
import { backupName, restorePlan, rootFields, rootKey, uniqueRoots, verifyBackup } from "../module/scripts/core/backup.mjs";

describe("sauvegardes du diagnostic (§177)", () => {
  it("restore plan: delete what was added, recreate what disappeared, put back the rest", () => {
    const current = [{ _id: "a" }, { _id: "b" }, { _id: "new" }];
    const saved = [{ _id: "a", name: "A" }, { _id: "b", name: "B" }, { _id: "gone", name: "G" }];
    expect(restorePlan(current, saved)).toEqual({
      remove: ["new"],
      create: [{ _id: "gone", name: "G" }],
      update: [{ _id: "a", name: "A" }, { _id: "b", name: "B" }]
    });
    expect(restorePlan([], [])).toEqual({ remove: [], create: [], update: [] });
  });

  it("a restore puts back neither the identity, nor the sorting, nor the permissions, nor the included collections", () => {
    const data = { _id: "x", _stats: {}, folder: "f", sort: 3, ownership: {}, name: "N", system: { a: 1 }, flags: { m: 1 }, items: [], effects: [] };
    expect(rootFields("Actor", data)).toEqual({ name: "N", system: { a: 1 }, flags: { m: 1 } });
    expect(rootFields("Item", { ...data, items: undefined })).toEqual({ name: "N", system: { a: 1 }, flags: { m: 1 }, items: undefined });
  });

  it("each root is backed up only once", () => {
    const a = { type: "Actor", uuid: "Actor.a" };
    const b = { type: "Token", uuid: "Scene.s.Token.t" };
    expect(uniqueRoots([{ root: a }, { root: b }, { root: a }, {}])).toEqual([a, b]);
    expect(rootKey(a)).toBe("Actor:Actor.a");
  });

  it("a reloaded backup is complete only with the same roots and the same ids of items and effects", () => {
    const expected = [
      { type: "Actor", uuid: "Actor.a", data: { items: [{ _id: "i1" }, { _id: "i2" }], effects: [{ _id: "e1" }] } },
      { type: "Item", uuid: "Item.w", data: { effects: [] } }
    ];
    expect(verifyBackup(expected, expected)).toEqual([]);
    expect(verifyBackup(expected, [expected[0]])).toEqual(["missing Item:Item.w"]);
    const lost = [{ ...expected[0], data: { items: [{ _id: "i1" }], effects: [{ _id: "e1" }] } }, expected[1]];
    expect(verifyBackup(expected, lost)).toEqual(["Actor:Actor.a: items differ"]);
  });

  it("dated name", () => {
    expect(backupName("Diagnostic", new Date(2026, 9, 13, 14, 5), 3)).toBe("Diagnostic — 2026-10-13 14:05 (3)");
  });
});
