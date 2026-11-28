import { describe, expect, it } from "vitest";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Mace of Smiting (SRD 5.2): a Construct at 25 HP or less after a 20 is destroyed", () => {
  const [rule] = ITEM_FIXES["mace-of-smiting"].triggers;
  const facts = (critical, type, hp) => ({ "hit.critical": want => critical === want, "target.creatureType": type,
    "target.hpAtMost": n => hp <= n });
  it("applied on the hit, hence after its damage: the \"dead\" condition", () => {
    expect(rule.on).toBe("hit");
    expect(rule.do).toEqual([{ type: "status", status: "dead" }]);
  });
  it("a 20, a Construct, 25 HP or less: all three together", () => {
    expect(holds(rule.if, facts(true, "construct", 25))).toBe(true);
    expect(holds(rule.if, facts(true, "construct", 26))).toBe(false);
    expect(holds(rule.if, facts(false, "construct", 8))).toBe(false);
    expect(holds(rule.if, facts(true, "undead", 8))).toBe(false);
  });
});
