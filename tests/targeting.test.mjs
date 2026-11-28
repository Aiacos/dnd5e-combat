import { describe, it, expect } from "vitest";
import { targetRule, targetRefusal, relationOf } from "../module/scripts/core/targeting.mjs";

const rule = (affects, more={}) => targetRule({ type: "utility", affects, rangeUnits: "touch", ...more });

describe("targeting rule", () => {
  it("a creature, a willing creature, any one, an ally: the caster included (Invisibility)", () => {
    for ( const affects of ["creature", "willing", "any", "ally", "creatureOrObject"] ) expect(rule(affects).self).toBe(true);
  });
  it("an enemy, an object, an attack: never oneself", () => {
    expect(rule("enemy")).toEqual({ self: false, side: "enemy" });
    expect(rule("object").self).toBe(false);
    expect(targetRule({ type: "attack", affects: "creature", rangeUnits: "ft" })).toEqual({ self: false, side: null });
  });
  it("cannot be targeted by a click: area, personal range, space, self", () => {
    expect(rule("creature", { template: "sphere" })).toBe(null);
    expect(rule("creature", { rangeUnits: "self" })).toBe(null);
    expect(rule("space")).toBe(null);
    expect(rule("self")).toBe(null);
    expect(rule("")).toBe(null);
  });
});

describe("refus", () => {
  it("oneself: according to the rule", () => {
    expect(targetRefusal(rule("creature"), { isSelf: true, relation: "same" })).toBe(null);
    expect(targetRefusal(rule("enemy"), { isSelf: true, relation: "same" })).toBe("self");
    expect(targetRefusal(targetRule({ type: "attack" }), { isSelf: true, relation: "same" })).toBe("self");
  });
  it("the side: only when declared on both sides", () => {
    expect(targetRefusal(rule("ally"), { isSelf: false, relation: "opposed" })).toBe("notAlly");
    expect(targetRefusal(rule("enemy"), { isSelf: false, relation: "same" })).toBe("notEnemy");
    expect(targetRefusal(rule("enemy"), { isSelf: false, relation: "neutral" })).toBe(null);
    expect(targetRefusal(rule("creature"), { isSelf: false, relation: "opposed" })).toBe(null);
  });
  it("relation between dispositions: neutral and secret do not settle it", () => {
    expect(relationOf(1, 1)).toBe("same");
    expect(relationOf(1, -1)).toBe("opposed");
    expect(relationOf(1, 0)).toBe("neutral");
    expect(relationOf(-2, -1)).toBe("neutral");
  });
});
