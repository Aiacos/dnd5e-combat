import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * §152: the cost cap that `approachDoor` and `walkToGap` pass to the A*. On 2026-10-11 (§147), `approachDoor` read an
 * undeclared `maxCost` (ReferenceError: doors in the menu unreachable at range) and `walkToGap` ignored its own (the Dissonant
 * Whispers flee capped to the turn budget instead of the full Speed). Only `planPath` is replaced; the geometry is real,
 * on a fake square grid. A token without an actor is out of combat: `movementCap` = Infinity.
 */
const calls = [];
vi.mock("../module/scripts/adapter/movement.mjs", async importOriginal => ({
  ...(await importOriginal()),
  planPath: (token, to, options) => { calls.push(options); return { arrives: true, waypoints: [] }; }
}));
const { approachDoor, walkToGap } = await import("../module/scripts/runtime/actions.mjs");

const grid = { isGridless: false, isSquare: true, size: 100, sizeX: 100, sizeY: 100,
  getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }) };
const scene = { grid, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 2000, sceneHeight: 2000 } };
const tokenAt = (x, y) => ({ actor: null, parent: scene, _source: { x, y, width: 1, height: 1, elevation: 0 } });

beforeEach(() => { calls.length = 0; });

describe("§152: movement cap toward a door, and for the flee", () => {
  it("approachDoor: a door at range is reached within the turn budget, without error", async () => {
    const wall = { document: { c: [500, 0, 500, 300] } };
    await expect(approachDoor(tokenAt(0, 0), wall)).resolves.toBe(true);
    expect(calls).toEqual([expect.objectContaining({ maxCost: Infinity })]);
  });
  it("walkToGap: the given cap (Dissonant Whispers Reaction) is the A*'s", async () => {
    await walkToGap(tokenAt(0, 0), tokenAt(1000, 1000), 3, { maxCost: 42 });
    expect(calls.at(-1).maxCost).toBe(42);
  });
  it("walkToGap: without a given cap, the turn budget", async () => {
    await walkToGap(tokenAt(0, 0), tokenAt(1000, 1000), 3);
    expect(calls.at(-1).maxCost).toBe(Infinity);
  });
});
