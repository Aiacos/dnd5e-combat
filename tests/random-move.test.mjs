import { describe, it, expect } from "vitest";
import { randomDirection, randomDie, DIRECTIONS } from "../module/scripts/core/control.mjs";
import { validateEntry, MOVE_MODES, MOVE_DIRECTIONS } from "../module/scripts/core/content.mjs";

const step = extra => ({ triggers: [{ on: "failedSave", do: [{ type: "move", mode: "random", distance: 5, units: "ft", ...extra }] }] });

describe("§497 : direction d'un déplacement aléatoire", () => {
  it("d4 nord, sud, est, ouest (Infestation)", () => {
    const dirs = ["n", "s", "e", "w"];
    expect(randomDie(dirs)).toBe(4);
    expect([1, 2, 3, 4].map(f => randomDirection(dirs, f))).toEqual([
      { key: "n", di: -1, dj: 0 }, { key: "s", di: 1, dj: 0 }, { key: "e", di: 0, dj: 1 }, { key: "w", di: 0, dj: -1 }
    ]);
  });

  it("sans liste : les huit directions, dans l'ordre du d8 de Confusion", () => {
    expect(randomDie(null)).toBe(8);
    expect(MOVE_DIRECTIONS).toHaveLength(8);
    for ( let f = 1; f <= 8; f++ ) expect(randomDirection(undefined, f)).toMatchObject(DIRECTIONS[f - 1]);
    expect(randomDirection([], 2).key).toBe("ne");
  });

  it("une face hors du dé ne donne rien", () => {
    expect(randomDirection(["n", "s"], 3)).toBeNull();
    expect(randomDirection(["n", "s"], 0)).toBeNull();
  });
});

describe("§497 : schéma de l'étape move random", () => {
  it("accepte la déclaration d'Infestation", () => {
    expect(MOVE_MODES).toContain("random");
    expect(validateEntry(step({ directions: ["n", "s", "e", "w"], ifBlocked: "stay", minSpeed: 5 }), { at: "x." })).toEqual([]);
    expect(validateEntry(step({}), { at: "x." })).toEqual([]);
    expect(validateEntry(step({ ifBlocked: "stop" }), { at: "x." })).toEqual([]);
  });

  it("refuse les formes fausses", () => {
    const bad = extra => validateEntry(step(extra), { at: "x." }).join(" | ");
    expect(bad({ directions: [] })).toMatch(/directions/);
    expect(bad({ directions: ["up"] })).toMatch(/directions/);
    expect(bad({ directions: ["n", "n"] })).toMatch(/directions/);
    expect(bad({ ifBlocked: "fall" })).toMatch(/ifBlocked/);
    expect(bad({ minSpeed: 0 })).toMatch(/minSpeed/);
    expect(bad({ upTo: true })).toMatch(/random/);
    expect(bad({ follow: true })).toMatch(/random/);
    const push = { triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft", directions: ["n"], ifBlocked: "stay", minSpeed: 5 }] }] };
    const errors = validateEntry(push, { at: "x." }).join(" | ");
    for ( const k of ["directions", "ifBlocked", "minSpeed"] ) expect(errors).toMatch(new RegExp(k));
  });
});
