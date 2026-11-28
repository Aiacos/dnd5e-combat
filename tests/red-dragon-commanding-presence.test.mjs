/**
 * Red dragons' Commanding Presence (SRD 5.2): a legendary action that casts Command. The same English name as the Fighter's
 * "commanding-presence" (bonus to Charisma checks) gave it the entry; two sources now separate them.
 */
import { describe, it, expect } from "vitest";
import { CONTENT, SOURCES } from "../module/scripts/content/index.mjs";

describe("Red dragons' Commanding Presence: no longer the Fighter's entry", () => {
  it("the two legendary actions have their own identifier, with no entry", () => {
    for ( const id of ["mmAdultRedDragon.mmCommandingPres", "mmAncientRedDrag.mmCommandingPres"] ) {
      expect(SOURCES[id]).toBe("mm-commanding-presence");
    }
    expect(CONTENT["mm-commanding-presence"]).toBeUndefined();
  });
  it("the Fighter's entry is intact", () => {
    expect(CONTENT["commanding-presence"]?.rollBonus?.skills).toEqual(["itm", "prf", "per"]);
  });
});
