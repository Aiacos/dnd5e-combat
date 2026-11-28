import { describe, it, expect } from "vitest";
import { tokenCenter } from "../module/scripts/adapter/turn.mjs";

/** `tokenCenter`: the center in pixels, at foot height, at the validated position (`_source`) or at a given position. */
const grid = { sizeX: 100, sizeY: 100 };
const token = (src) => ({ parent: { grid }, _source: { x: 0, y: 0, elevation: 0, width: 1, height: 1, ...src } });

describe("tokenCenter", () => {
  it("at the validated position: the middle of its space, at its elevation", () => {
    expect(tokenCenter(token({ x: 200, y: 300, width: 2, height: 2, elevation: 10 }))).toEqual({ x: 300, y: 400, elevation: 10 });
  });
  it("at a given position (waypoint): its size and its elevation if the position does not give them", () => {
    expect(tokenCenter(token({ width: 2, height: 1, elevation: 5 }), { x: 0, y: 0 })).toEqual({ x: 100, y: 50, elevation: 5 });
    expect(tokenCenter(token({}), { x: 0, y: 0, width: 3, height: 3, elevation: 0 })).toEqual({ x: 150, y: 150, elevation: 0 });
  });
});
