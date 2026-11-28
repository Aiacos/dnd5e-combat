import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Sunlight Weakness (Shadow, SRD 5.2): Disadvantage on D20 Tests in sunlight", () => {
  const entry = CONTENT["sunlight-weakness"];
  it("attack rolls: Disadvantage in sunlight only", () => {
    const [rule] = entry.triggers;
    expect(rule.on).toBe("preAttackRoll");
    expect(rule.do).toEqual([{ type: "disadvantage" }]);
    expect(holds(rule.if, { "source.inSunlight": true })).toBe(true);
    expect(holds(rule.if, { "source.inSunlight": false })).toBe(false);
  });
  it("ability checks and saving throws: the same condition, read from the creature", () => {
    expect(entry.rollDisadvantage).toEqual({ on: ["check", "save"], if: { "self.inSunlight": true } });
  });
});
