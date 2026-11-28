/** Speed is read in the unit of the token's scene, not in that of the scene this client is viewing. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { movementOf } = await import("../module/scripts/adapter/turn.mjs");

const factors = { ft: 1, m: 3.28084 };

beforeEach(() => {
  globalThis.CONFIG = { Token: { movement: { actions: { walk: {} } } }, DND5E: { movementTypes: { walk: {} } } };
  globalThis.canvas = { scene: { grid: { units: "m" } } };          // the GM views another scene, in meters
});
afterEach(() => { delete globalThis.CONFIG; delete globalThis.canvas; });

describe("movement of a combatant whose scene is not the one displayed", () => {
  it("speed and movement spent in the same unit, that of its scene", () => {
    const actor = { system: { attributes: { movement: { units: "ft", walk: 30 } } }, appliedEffects: [], effects: [], items: [] };
    const scene = { grid: { units: "ft" } };
    const token = { parent: scene, movementHistory: [{ cost: 10, action: "walk" }], _source: { movementAction: "walk" } };
    const combatant = { actor, token, getFlag: () => ({ climbed: 0, stood: 0, jumped: 0 }) };
    expect(movementOf(combatant, factors)).toEqual({ spent: 10, speed: 30, units: "ft" });
  });
});
