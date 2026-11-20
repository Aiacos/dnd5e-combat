import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Faiblesse au soleil (Ombre, SRD 5.2) : Désavantage aux Tests de d20 au soleil", () => {
  const entry = CONTENT["sunlight-weakness"];
  it("jets d'attaque : Désavantage au soleil seulement", () => {
    const [rule] = entry.triggers;
    expect(rule.on).toBe("preAttackRoll");
    expect(rule.do).toEqual([{ type: "disadvantage" }]);
    expect(holds(rule.if, { "source.inSunlight": true })).toBe(true);
    expect(holds(rule.if, { "source.inSunlight": false })).toBe(false);
  });
  it("tests de caractéristique et jets de sauvegarde : la même condition, lue sur la créature", () => {
    expect(entry.rollDisadvantage).toEqual({ on: ["check", "save"], if: { "self.inSunlight": true } });
  });
});
