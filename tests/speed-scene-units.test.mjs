/** La vitesse se lit dans l'unité de la scène du token, pas dans celle de la scène que ce client regarde. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { movementOf } = await import("../module/scripts/adapter/turn.mjs");

const factors = { ft: 1, m: 3.28084 };

beforeEach(() => {
  globalThis.CONFIG = { Token: { movement: { actions: { walk: {} } } }, DND5E: { movementTypes: { walk: {} } } };
  globalThis.canvas = { scene: { grid: { units: "m" } } };          // le MJ regarde une autre scène, en mètres
});
afterEach(() => { delete globalThis.CONFIG; delete globalThis.canvas; });

describe("déplacement d'un combattant dont la scène n'est pas celle affichée", () => {
  it("vitesse et déplacement dépensé dans la même unité, celle de sa scène", () => {
    const actor = { system: { attributes: { movement: { units: "ft", walk: 30 } } }, appliedEffects: [], effects: [], items: [] };
    const scene = { grid: { units: "ft" } };
    const token = { parent: scene, movementHistory: [{ cost: 10, action: "walk" }], _source: { movementAction: "walk" } };
    const combatant = { actor, token, getFlag: () => ({ climbed: 0, stood: 0, jumped: 0 }) };
    expect(movementOf(combatant, factors)).toEqual({ spent: 10, speed: 30, units: "ft" });
  });
});
