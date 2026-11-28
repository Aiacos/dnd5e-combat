import { describe, it, expect } from "vitest";
import { pushDirection } from "../module/scripts/core/movement.mjs";

describe("direction of a push (Shove)", () => {
  it("droit devant : la direction de la source vers la cible", () => {
    expect(pushDirection({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ di: 0, dj: 1 });
    expect(pushDirection({ x: 0, y: 0 }, { x: -100, y: 0 })).toEqual({ di: 0, dj: -1 });
    expect(pushDirection({ x: 0, y: 0 }, { x: 0, y: 100 })).toEqual({ di: 1, dj: 0 });
    expect(pushDirection({ x: 0, y: 0 }, { x: 0, y: -100 })).toEqual({ di: -1, dj: 0 });
  });
  it("en diagonale", () => {
    expect(pushDirection({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({ di: 1, dj: 1 });
    expect(pushDirection({ x: 0, y: 0 }, { x: -100, y: 100 })).toEqual({ di: 1, dj: -1 });
  });
  it("rounded to the nearest direction (large token offset)", () => {
    expect(pushDirection({ x: 0, y: 0 }, { x: 300, y: 50 })).toEqual({ di: 0, dj: 1 });
    expect(pushDirection({ x: 0, y: 0 }, { x: 300, y: 250 })).toEqual({ di: 1, dj: 1 });
  });
  it("confondus : aucune direction", () => {
    expect(pushDirection({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(null);
  });
});

import { dragMultiplier, dragAllowance } from "../module/scripts/core/movement.mjs";

describe("grappler dragging its victim (Grappled, \"Movable\")", () => {
  it("cost doubled, except for a Tiny victim or one at least two sizes smaller", () => {
    expect(dragMultiplier(2, [2])).toBe(2);   // M drags M
    expect(dragMultiplier(2, [1])).toBe(2);   // M drags S: one size step
    expect(dragMultiplier(3, [1])).toBe(1);   // L drags S: two size steps
    expect(dragMultiplier(2, [0])).toBe(1);   // TP
    expect(dragMultiplier(2, [])).toBe(1);    // personne
    expect(dragMultiplier(3, [1, 3])).toBe(2); // une victime lourde suffit
  });
  it("what remains to travel counts double", () => {
    expect(dragAllowance(30, 10, 2)).toBe(20);   // 20 ft remaining → 10 ft while dragging
    expect(dragAllowance(30, 10, 1)).toBe(30);
    expect(dragAllowance(Infinity, 0, 2)).toBe(Infinity);
    expect(dragAllowance(30, 40, 2)).toBe(40);   // already beyond: nothing more
  });
});
