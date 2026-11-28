import { describe, it, expect } from "vitest";
import { ORDERS, orderPlan, footprintDistance, cellsAtGap, DIRECTIONS, directionTarget } from "../module/scripts/core/orders.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("imposed order (§16.59)", () => {
  it("each order of the 2024 PHB has its plan", () => {
    for ( const o of ORDERS ) expect(orderPlan(o), o).not.toBe(null);
    expect(orderPlan("grovel")).toMatchObject({ prone: true, ends: "always" });
    expect(orderPlan("approach")).toMatchObject({ move: "toward", ends: "ifArrived" });
    expect(orderPlan("flee")).toMatchObject({ move: "away", ends: "always" });
    expect(orderPlan("drop")).toMatchObject({ drop: true, ends: "always" });
    expect(orderPlan("halt")).toMatchObject({ move: null, prone: false, drop: false, ends: "always" });
    expect(orderPlan("dance")).toBe(null);
  });
  it("gap between footprints: contact 0, overlap -1, diagonal counted as one cell", () => {
    const a = { i: 5, j: 5, w: 1, h: 1 };
    expect(footprintDistance({ i: 6, j: 5, w: 1, h: 1 }, a)).toBe(0);
    expect(footprintDistance({ i: 6, j: 6, w: 1, h: 1 }, a)).toBe(0);
    expect(footprintDistance({ i: 5, j: 5, w: 1, h: 1 }, a)).toBe(-1);
    expect(footprintDistance({ i: 9, j: 7, w: 1, h: 1 }, a)).toBe(3);
    expect(footprintDistance({ i: 7, j: 5, w: 2, h: 2 }, a)).toBe(1);
  });
  it("non-square footprint: `i` (row) goes with the height, `j` (column) with the width", () => {
    // Two cells wide by one high, at (row 5, column 5): occupies columns 5 and 6.
    const wide = { i: 5, j: 5, w: 2, h: 1 };
    expect(footprintDistance({ i: 5, j: 7, w: 1, h: 1 }, wide)).toBe(0);    // just to the right
    expect(footprintDistance({ i: 5, j: 6, w: 1, h: 1 }, wide)).toBe(-1);   // sous sa seconde colonne
    expect(footprintDistance({ i: 7, j: 5, w: 1, h: 1 }, wide)).toBe(1);    // two rows down: one cell of gap
    expect(footprintDistance(wide, { i: 5, j: 7, w: 1, h: 1 })).toBe(0);    // symmetric
    const around = cellsAtGap(wide, { w: 1, h: 1 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(around).toHaveLength(10);
    expect(around.every(c => footprintDistance({ ...c, w: 1, h: 1 }, wide) === 0)).toBe(true);
    // A tall footprint (one column, two rows) placed on the scene's bottom edge: both rows must fit inside.
    const tall = cellsAtGap({ i: 19, j: 5, w: 1, h: 1 }, { w: 1, h: 2 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(tall.every(c => c.i + 1 <= 20)).toBe(true);
    expect(tall.every(c => footprintDistance({ ...c, w: 1, h: 2 }, { i: 19, j: 5, w: 1, h: 1 }) === 0)).toBe(true);
  });
  it("cells touching a cell: the eight around it, clamped to the scene", () => {
    const around = cellsAtGap({ i: 5, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(around).toHaveLength(8);
    const corner = cellsAtGap({ i: 0, j: 0, w: 1, h: 1 }, { w: 1, h: 1 }, 0, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(corner).toHaveLength(3);
    const far = cellsAtGap({ i: 5, j: 5, w: 1, h: 1 }, { w: 1, h: 1 }, 2, { i0: 0, j0: 0, i1: 20, j1: 20 });
    expect(far.every(c => footprintDistance({ ...c, w: 1, h: 1 }, { i: 5, j: 5, w: 1, h: 1 }) === 2)).toBe(true);
    expect(far).toHaveLength(24);
  });
  it("schema: orders, list of known orders", () => {
    expect(validateEntry({ orders: ["grovel", "halt"] }, { facts: {} })).toEqual([]);
    expect(validateEntry({ orders: ["grovel", "dance"] }, { facts: {} })).toHaveLength(1);
  });
});

describe("Compulsion: walk in a direction (§403)", () => {
  it("eight directions, the farthest cell the movement reaches", () => {
    expect(Object.keys(DIRECTIONS)).toHaveLength(8);
    expect(directionTarget({ i: 5, j: 5 }, "n", 6)).toEqual({ i: -1, j: 5 });
    expect(directionTarget({ i: 5, j: 5 }, "se", 2)).toEqual({ i: 7, j: 7 });
  });
  it("clamped to the scene's edge; nothing without steps or without a direction", () => {
    expect(directionTarget({ i: 2, j: 5 }, "n", 6, { rows: 10, columns: 10 })).toEqual({ i: 0, j: 5 });
    expect(directionTarget({ i: 2, j: 8 }, "ne", 6, { rows: 10, columns: 10 })).toEqual({ i: 1, j: 9 });
    expect(directionTarget({ i: 0, j: 5 }, "n", 6, { rows: 10, columns: 10 })).toBeNull();
    expect(directionTarget({ i: 5, j: 5 }, "up", 6)).toBeNull();
    expect(directionTarget({ i: 5, j: 5 }, "e", 0)).toBeNull();
  });
  it("the content key and the save option", () => {
    expect(validateEntry({ compels: true, triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", ifCompelled: true }] }] })).toEqual([]);
    expect(validateEntry({ compels: 1 })).toHaveLength(1);
    expect(validateEntry({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", ifCompelled: "yes" }] }] })).toHaveLength(1);
  });
});
