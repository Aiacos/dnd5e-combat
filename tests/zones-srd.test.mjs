import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("SRD 5.2 zones whose save comes on entering and on the turn, not when placed", () => {
  it("Zone of Truth: on entering and at turn start; nothing when placed, and no effect without a failed save", () => {
    const entry = CONTENT["zone-of-truth"];
    expect(entry.triggers).toEqual([{ on: ["enter", "turnStart"], do: [{ type: "replay" }] }]);
    expect(entry.quietPose).toBe(true);
    expect(entry.zoneEffects).toBeUndefined();
    expect(validateEntry(entry)).toEqual([]);
  });
  it("Control Water: the whirlpool, on entering and at the END of the turn; nothing when placed", () => {
    const entry = CONTENT["control-water"];
    expect(entry.triggers).toEqual([{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dnd5eactivity000" }] }]);
    expect(entry.quietPose).toBe(true);
    expect(validateEntry(entry)).toEqual([]);
  });
});
