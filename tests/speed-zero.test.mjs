/**
 * Cloak of Displacement (Dungeon Master's Guide 2024, SRD 5.2): the property is suspended while the bearer's Speed is 0. The entry
 * only looked at the Incapacitated condition (the 2014 text): seen in play, a Grappled bearer kept the attackers' Disadvantage.
 */
import { describe, it, expect } from "vitest";
import { speedIsZero } from "../module/scripts/core/movement.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("speedIsZero", () => {
  it("all speeds at 0: yes (jump does not count)", () => {
    expect(speedIsZero({ walk: 0, burrow: 0, climb: 0, fly: 0, swim: 0, jump: 8 })).toBe(true);
    expect(speedIsZero({})).toBe(true);
  });
  it("a speed that remains: no", () => {
    expect(speedIsZero({ walk: 30, burrow: 0, climb: 0, fly: 0, swim: 0 })).toBe(false);
    expect(speedIsZero({ walk: 0, fly: 60 })).toBe(false);
    expect(speedIsZero({ walk: "30" })).toBe(false);
  });
  it("without movement data: no", () => {
    expect(speedIsZero(null)).toBe(false);
    expect(speedIsZero(undefined)).toBe(false);
  });
});

describe("Cloak of Displacement: when the attackers have Disadvantage", () => {
  const condition = CONTENT["cloak-of-displacement"].triggers[0].if;
  const wearer = ({ suppressed=false, speedZero=false, incapacitated=false }={}) => ({
    "target.hasEffect": id => suppressed && (id === "cloak-of-displacement"),
    "target.speedZero": want => speedZero === want,
    "target.hasStatus": id => incapacitated && (id === "incapacitated") });

  it("porteur libre : oui", () => expect(holds(condition, wearer())).toBe(true));
  it("Speed of 0 (Grappled, Restrained): no", () => expect(holds(condition, wearer({ speedZero: true }))).toBe(false));
  it("property suspended after damage: no", () => expect(holds(condition, wearer({ suppressed: true }))).toBe(false));
  it("Incapacitated (2014 text, same identifier): no", () => expect(holds(condition, wearer({ incapacitated: true }))).toBe(false));
});
