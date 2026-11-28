/**
 * Vampire weaknesses (Vampire, Vampire Spawn; SRD 5.2): the trait has several entries, of which the text reading only drew the
 * Disadvantage on attack rolls in sunlight. The shipped entry carries the rest of what plays out in combat.
 */
import { describe, it, expect } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Faiblesses du vampire", () => {
  const entry = CONTENT["vampire-weakness"];
  const at = (moment) => entry.triggers.filter(t => t.on === moment);
  it("in sunlight: Disadvantage on attack rolls and checks, 20 Radiant damage at the start of its turn", () => {
    expect(entry.rollDisadvantage).toEqual({ on: ["check"], if: { "self.inSunlight": true } });
    expect(at("preAttackRoll")).toEqual([{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] }]);
    expect(at("startOfTurn")[0].do).toEqual([{ type: "damage", to: "self", formula: "20", damageType: "radiant" }]);
    expect(holds(at("startOfTurn")[0].if, { "self.inSunlight": want => want === true })).toBe(true);
    expect(holds(at("startOfTurn")[0].if, { "self.inSunlight": want => want === false })).toBe(false);
  });
  it("in running water at the end of its turn: 20 Acid damage", () => {
    expect(at("endOfTurn")).toEqual([{ on: "endOfTurn", if: { "self.inRunningWater": true },
      do: [{ type: "damage", to: "self", formula: "20", damageType: "acid" }] }]);
  });
});
