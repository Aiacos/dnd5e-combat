/**
 * Corrosive Form of the Black Pudding (SRD 5.2): whoever hits it with a melee attack roll takes
 * 1d8 acid damage — with no distance clause (the 2014 one, "within 1.50 m", is no longer in the text). Seen in play: a
 * strike with a Glaive (reach) made from 3 m triggered nothing, the same strike made in contact did.
 */
import { describe, it, expect } from "vitest";
import { normalize, select } from "../module/scripts/core/triggers.mjs";
import { TRIGGERS } from "../module/scripts/content/triggers.mjs";

const declared = TRIGGERS["corrosive-form"].map(d => normalize(d, { name: "Corrosive Form" }));
const within = feet => rule => feet <= rule.distance;

describe("Forme corrosive", () => {
  it("a melee hit from 3 m (reach weapon) triggers the acid damage, as in contact", () => {
    for ( const feet of [5, 10] ) {
      const facts = { "activity.isMelee": true, "activity.isAttack": true, "target.within": within(feet) };
      expect(select(declared, "isHit", facts).map(d => d.do[0]), `${feet} ft`)
        .toEqual([{ type: "damage", to: "source", activity: "OzlTY1z1gup4C2Qq" }]);
    }
  });
  it("a ranged attack triggers nothing", () => {
    const facts = { "activity.isMelee": false, "activity.isAttack": true, "target.within": within(5) };
    expect(select(declared, "isHit", facts)).toEqual([]);
  });
  it("the entry carries no distance condition", () => {
    expect(Object.keys(TRIGGERS["corrosive-form"][0].if)).toEqual(["activity.isMelee"]);
  });
});
