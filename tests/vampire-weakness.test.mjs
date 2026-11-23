/**
 * Faiblesses du vampire (Vampire, Vampirien ; SRD 5.2) : le trait a plusieurs rubriques, dont la lecture du texte ne tirait que le
 * Désavantage aux jets d'attaque au soleil. L'entrée livrée porte le reste de ce qui se joue en combat.
 */
import { describe, it, expect } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Faiblesses du vampire", () => {
  const entry = CONTENT["vampire-weakness"];
  const at = (moment) => entry.triggers.filter(t => t.on === moment);
  it("au soleil : Désavantage aux jets d'attaque et aux tests, 20 dégâts radiants au début de son tour", () => {
    expect(entry.rollDisadvantage).toEqual({ on: ["check"], if: { "self.inSunlight": true } });
    expect(at("preAttackRoll")).toEqual([{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] }]);
    expect(at("startOfTurn")[0].do).toEqual([{ type: "damage", to: "self", formula: "20", damageType: "radiant" }]);
    expect(holds(at("startOfTurn")[0].if, { "self.inSunlight": want => want === true })).toBe(true);
    expect(holds(at("startOfTurn")[0].if, { "self.inSunlight": want => want === false })).toBe(false);
  });
  it("dans l'eau courante à la fin de son tour : 20 dégâts d'acide", () => {
    expect(at("endOfTurn")).toEqual([{ on: "endOfTurn", if: { "self.inRunningWater": true },
      do: [{ type: "damage", to: "self", formula: "20", damageType: "acid" }] }]);
  });
});
