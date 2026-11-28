/**
 * #110, #111: a diagnostic task whose document was removed by an earlier repair of the same pass. dnd5e deletes the spells
 * an item gave along with it and recreates them under another id; Midi-QOL's cleanup replaces the item, and the next task was
 * about a spell that no longer exists. It is skipped, not failed, and nothing is written to the analysis document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const world = new Map();

beforeEach(() => {
  world.clear();
  globalThis.fromUuidSync = (uuid, { strict=true }={}) => {
    const doc = world.get(uuid);
    if ( !doc && strict ) throw new Error(`undefined id [${uuid}] does not exist in the EmbeddedCollection collection.`);
    return doc ?? null;
  };
  globalThis.game = { user: { isGM: true, name: "GM" }, i18n: { localize: k => k, format: (k, d) => `${k} ${JSON.stringify(d)}` } };
  globalThis.foundry = { utils: { escapeHTML: s => String(s) } };
});

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

describe("fresh — the document of a task at the moment of repair", () => {
  it("returns the re-read document, not the analysis one", async () => {
    const { fresh } = await import("../module/scripts/runtime/diagnostic/fresh.mjs");
    const scanned = { uuid: "Actor.a.Item.i", documentName: "Item", parent: { documentName: "Actor", isToken: false } };
    const now = { uuid: "Actor.a.Item.i" };
    world.set(scanned.uuid, now);
    expect(fresh(scanned)).toBe(now);
  });

  it("throws VanishedError for a removed document, instead of returning the analysis one", async () => {
    const { fresh, VanishedError } = await import("../module/scripts/runtime/diagnostic/fresh.mjs");
    const scanned = { uuid: "Actor.a.Item.gone", documentName: "Item", parent: { documentName: "Actor", isToken: false } };
    expect(() => fresh(scanned)).toThrow(VanishedError);
    try { fresh(scanned); } catch(err) { expect(err.vanished).toBe(true); }
  });

  it("the item of a token actor is re-read through the token; removed, it throws too", async () => {
    const { fresh, VanishedError } = await import("../module/scripts/runtime/diagnostic/fresh.mjs");
    const kept = { id: "k" };
    const actorNow = { items: new Map([["k", kept]]) };
    world.set("Scene.s.Token.t", { actor: actorNow });
    const parent = { documentName: "Actor", isToken: true, token: { uuid: "Scene.s.Token.t" } };
    expect(fresh({ id: "k", collectionName: "items", parent })).toBe(kept);
    expect(() => fresh({ id: "gone", collectionName: "items", parent })).toThrow(VanishedError);
    world.delete("Scene.s.Token.t");
    expect(() => fresh(parent)).toThrow(VanishedError);
  });
});

describe("repairTasks — a task without a document is skipped", () => {
  it("does not count as a failure, writes nothing, and the following tasks are repaired", async () => {
    vi.doMock("../module/scripts/runtime/diagnostic/checks.mjs", () => ({ CHECKS: [] }));
    vi.doMock("../module/scripts/runtime/diagnostic/backup.mjs", () => ({
      createBackup: async () => ({ uuid: "Compendium.world.das-backups.Adventure.b", name: "backup" }),
      listBackups: async () => [], restoreBackup: async () => null
    }));
    vi.doMock("../module/scripts/core/backup.mjs", () => ({ uniqueRoots: tasks => tasks.map(t => t.root) }));
    vi.doMock("../module/scripts/runtime/shared.mjs", () => ({ loc: (k, d) => (d ? `${k} ${d.error}` : k), log: () => {} }));
    const { fresh } = await import("../module/scripts/runtime/diagnostic/fresh.mjs");
    const { repairTasks } = await import("../module/scripts/runtime/diagnostic/index.mjs");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = { uuid: "Actor.a" };
    const parent = { documentName: "Actor", isToken: false };
    const spell = { uuid: "Actor.a.Item.cached", documentName: "Item", parent, update: vi.fn() };
    const other = { uuid: "Actor.a.Item.other", documentName: "Item", parent, update: vi.fn() };
    world.set(other.uuid, other);
    const task = (n, apply) => ({ id: `magical-effects.${n}`, check: "magical-effects", root, apply });
    const tasks = [
      task(0, async () => { await fresh(spell).update({}); return "marked"; }),
      task(1, async () => { await fresh(other).update({}); return "marked"; }),
      task(2, async () => { throw new Error("boom"); })
    ];
    const { results } = await repairTasks(tasks);
    expect(results.map(r => r.ok)).toEqual([true, true, false]);
    expect(results[0].line).toBe("Diagnostic.ReparationDisparu");
    expect(results[1].line).toBe("marked");
    expect(spell.update).not.toHaveBeenCalled();
    expect(other.update).toHaveBeenCalledTimes(1);
    // Only the real error is logged (DAS's error log turns it into a report).
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("magical-effects.2");
  });
});

describe("cleanActor — an item removed earlier in the loop is skipped (#111)", () => {
  it("does not delete a second time the spell that dnd5e removed along with the item that gave it", async () => {
    vi.doUnmock("../module/scripts/runtime/diagnostic/checks.mjs");
    vi.doUnmock("../module/scripts/runtime/diagnostic/backup.mjs");
    vi.doUnmock("../module/scripts/core/backup.mjs");
    vi.doUnmock("../module/scripts/runtime/shared.mjs");
    globalThis.foundry.data = { operators: { ForcedDeletion: class {} } };
    const { cleanActor } = await import("../module/scripts/runtime/diagnostic/checks.mjs");
    const items = new Map();
    const collection = {
      has: id => items.has(id), get: id => items.get(id),
      filter: fn => [...items.values()].filter(fn), [Symbol.iterator]: () => items.values()
    };
    const item = (id, removes=[]) => ({
      id, name: id, type: "feat", flags: {}, effects: [], system: { identifier: "generic-actions" }, _stats: {},
      delete: vi.fn(async function() {
        if ( !items.has(id) ) throw new Error(`undefined id [${id}] does not exist in the EmbeddedCollection collection.`);
        for ( const gone of [id, ...removes] ) items.delete(gone);
      })
    });
    const giver = item("giver", ["granted"]);
    const granted = item("granted");
    items.set(giver.id, giver).set(granted.id, granted);
    const actor = { items: collection, effects: [], flags: {} };
    const lines = await cleanActor(actor, false);
    expect(giver.delete).toHaveBeenCalledTimes(1);
    expect(granted.delete).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
  });
});
