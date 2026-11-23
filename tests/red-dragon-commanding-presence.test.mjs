/**
 * Présence imposante des dragons rouges (SRD 5.2) : une action légendaire qui lance Injonction. Le même nom anglais que la
 * « commanding-presence » du Guerrier (bonus aux tests de Charisme) lui en donnait l'entrée ; deux sources l'en séparent.
 */
import { describe, it, expect } from "vitest";
import { CONTENT, SOURCES } from "../module/scripts/content/index.mjs";

describe("Présence imposante des dragons rouges : plus l'entrée du Guerrier", () => {
  it("les deux actions légendaires ont leur propre identifiant, sans entrée", () => {
    for ( const id of ["mmAdultRedDragon.mmCommandingPres", "mmAncientRedDrag.mmCommandingPres"] ) {
      expect(SOURCES[id]).toBe("mm-commanding-presence");
    }
    expect(CONTENT["mm-commanding-presence"]).toBeUndefined();
  });
  it("l'entrée du Guerrier est intacte", () => {
    expect(CONTENT["commanding-presence"]?.rollBonus?.skills).toEqual(["itm", "prf", "per"]);
  });
});
