import { describe, it, expect } from "vitest";
import { validateEntry, WEAPON_KINDS } from "../module/scripts/core/content.mjs";
import { maximizeDice } from "../module/scripts/core/max-dice.mjs";

const v = entry => validateEntry(entry, { facts: {} });

describe("§279: maximum damage and damage types of a weapon", () => {
  it("maxDamage: activity, weapon kinds, refund on a hit", () => {
    expect(v({ maxDamage: { activity: "essaiActivite001" } })).toEqual([]);
    expect(v({ maxDamage: { activity: "essaiActivite001", weapons: ["unarmed", "simpleM", "improv"], refundOnHit: true } })).toEqual([]);
    expect(v({ maxDamage: { activity: "court" } })[0]).toMatch(/maxDamage/);
    expect(v({ maxDamage: { activity: "essaiActivite001", weapons: ["fists"] } })[0]).toMatch(/maxDamage/);
  });

  it("maxNextHit et weaponDamageTypes", () => {
    expect(v({ maxNextHit: true })).toEqual([]);
    expect(v({ maxNextHit: "yes" })[0]).toMatch(/maxNextHit/);
    expect(v({ weaponDamageTypes: { weapons: ["unarmed", "improv"], types: ["force"] } })).toEqual([]);
    expect(v({ weaponDamageTypes: { weapons: [], types: ["force"] } })[0]).toMatch(/weaponDamageTypes/);
    expect(WEAPON_KINDS).toContain("unarmed");
  });

  it("the maximum of a weapon roll's dice: the dice only, the bonus stays", () => {
    expect(maximizeDice("1d8 + @mod")).toBe("(1*8) + @mod");
    expect(maximizeDice("2d6r1")).toBe("(2*6)");
  });
});
