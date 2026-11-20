import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("Marche sur le vent (SRD 5.2) : sous la forme de nuage, ni attaque ni sort", () => {
  it("le porteur de l'effet du sort ne peut ni attaquer ni lancer de sorts, comme sous Forme gazeuse", () => {
    expect(CONTENT["wind-walk"].noAttacksOrSpells).toBe(true);
    expect(CONTENT["gaseous-form"].noAttacksOrSpells).toBe(true);
  });
});
