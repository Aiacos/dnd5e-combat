import { describe, expect, it } from "vitest";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Masse de châtiment (SRD 5.2) : une Créature artificielle à 25 PV ou moins après un 20 est détruite", () => {
  const [rule] = ITEM_FIXES["mace-of-smiting"].triggers;
  const facts = (critical, type, hp) => ({ "hit.critical": want => critical === want, "target.creatureType": type,
    "target.hpAtMost": n => hp <= n });
  it("posé au coup, donc après ses dégâts : l'état « dead »", () => {
    expect(rule.on).toBe("hit");
    expect(rule.do).toEqual([{ type: "status", status: "dead" }]);
  });
  it("un 20, une Créature artificielle, 25 PV ou moins : les trois ensemble", () => {
    expect(holds(rule.if, facts(true, "construct", 25))).toBe(true);
    expect(holds(rule.if, facts(true, "construct", 26))).toBe(false);
    expect(holds(rule.if, facts(false, "construct", 8))).toBe(false);
    expect(holds(rule.if, facts(true, "undead", 8))).toBe(false);
  });
});
