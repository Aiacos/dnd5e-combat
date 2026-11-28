import { describe, it, expect } from "vitest";
import { familiarBasicKinds, carriedItemIds, recallProblem, recalledTokenData, RECALL_RANGE, POCKET_COST } from "../module/scripts/core/familiar.mjs";
import { BASIC_ACTIONS } from "../module/scripts/content/actions.mjs";
import { SUMMONS } from "../module/scripts/content/summons.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

const M = "dnd5e-combat";

describe("familiers (§107)", () => {
  it("receive the base actions, except those that attack — Help included", () => {
    const kinds = familiarBasicKinds(BASIC_ACTIONS);
    expect(kinds).toContain("help");
    expect(kinds).toContain("dodge");
    expect(kinds).not.toContain("unarmed");
    expect(kinds).not.toContain("improvised");   // §213 : une attaque d'arme
    expect(kinds).toHaveLength(Object.keys(BASIC_ACTIONS).length - 2);
    expect(familiarBasicKinds({ a: {}, b: { attack: true } })).toEqual(["a"]);
  });

  it("Find Familiar, Wild Companion and Pact of the Chain are familiars with their own Initiative", () => {
    for ( const id of ["find-familiar", "wild-companion", "pact-of-the-chain"] ) {
      expect(SUMMONS[id]).toMatchObject({ initiative: "own", familiar: true });
      expect(validateEntry({ summon: SUMMONS[id] }, { at: id })).toEqual([]);
    }
    expect(validateEntry({ summon: { initiative: "own", familiar: "oui" } }).length).toBeGreaterThan(0);
  });

  it("what it carries: the items, not its natural weapons nor the engine's items", () => {
    const items = [
      { id: "a", type: "weapon", system: { type: { value: "natural" } } },
      { id: "b", type: "consumable", system: { type: { value: "potion" } } },
      { id: "c", type: "feat", system: {} },
      { id: "d", type: "equipment", system: { type: { value: "natural" } } },
      { id: "e", type: "equipment", system: { type: { value: "trinket" } } },
      { id: "f", type: "loot", system: {} },
      { id: "g", type: "weapon", system: { type: { value: "natural" } }, flags: { [M]: { basicAction: "unarmed" } } },
      { id: "h", type: "weapon", system: { type: { value: "simpleM" } } }
    ];
    expect(carriedItemIds(items, M)).toEqual(["b", "e", "f", "h"]);
    expect(carriedItemIds(null, M)).toEqual([]);
  });

  it("the respawn cell: within 9 m at most, unoccupied", () => {
    expect(RECALL_RANGE).toEqual({ value: 30, units: "ft" });
    expect(POCKET_COST).toBe("action");
    expect(recallProblem({ distance: 30, limit: 30, occupied: false })).toBe(null);
    expect(recallProblem({ distance: 35, limit: 30, occupied: false })).toBe("far");
    expect(recallProblem({ distance: 5, limit: 30, occupied: true })).toBe("occupied");
    expect(recallProblem({ distance: Infinity, limit: 30, occupied: false })).toBe("far");
  });

  it("the token that returns keeps its delta, loses its id and its follow order, takes the chosen cell", () => {
    const stored = { _id: "abcdefghijklmnop", _stats: { createdTime: 1 }, name: "Chouette", actorId: "A", x: 0, y: 0, elevation: 30,
      level: "L1", delta: { system: { attributes: { hp: { value: 1 } } } },
      flags: { [M]: { follow: { leader: "X" }, expiresAt: 100 }, other: { k: 1 } } };
    const data = recalledTokenData(stored, { x: 200, y: 300, elevation: 0, level: "L2" }, M);
    expect(data._id).toBeUndefined();
    expect(data._stats).toBeUndefined();
    expect(data).toMatchObject({ name: "Chouette", x: 200, y: 300, elevation: 0, level: "L2", delta: { system: { attributes: { hp: { value: 1 } } } } });
    expect(data.flags[M]).toEqual({ expiresAt: 100 });
    expect(data.flags.other).toEqual({ k: 1 });
    expect(stored.flags[M].follow).toEqual({ leader: "X" });   // the stored data is not touched
    expect(recalledTokenData({ flags: { [M]: { follow: {} } } }, { x: 0, y: 0 }, M).flags[M]).toBeUndefined();
  });
});
