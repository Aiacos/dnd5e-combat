import { describe, it, expect } from "vitest";
import { clampToCircle } from "../module/scripts/core/storm.mjs";

describe("§70: the lightning stays under the cloud", () => {
  const center = { x: 100, y: 100 };
  it("a point under the cloud stays put", () => expect(clampToCircle({ x: 130, y: 90 }, center, 50)).toEqual({ x: 130, y: 90 }));
  it("a point outside the cloud snaps to its edge", () => expect(clampToCircle({ x: 300, y: 100 }, center, 50)).toEqual({ x: 150, y: 100 }));
  it("the center itself", () => expect(clampToCircle(center, center, 50)).toEqual(center));
});
