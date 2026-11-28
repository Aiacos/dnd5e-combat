import { describe, expect, it } from "vitest";
import { SHIPPED, SRD_ALIASES } from "../module/scripts/content/index.mjs";

describe("SRD aliases (survey of gaps, 2026-10-22)", () => {
  it("each spell renamed by the SRD has the Handbook's entry", () => {
    for ( const [srd, phb] of Object.entries(SRD_ALIASES) ) {
      expect(SHIPPED[phb], phb).toBeTruthy();
      expect(SHIPPED[srd], srd).toBe(SHIPPED[phb]);
    }
  });

  it("Evard's Black Tentacles: nothing on a successful save, in the Handbook as in the SRD", () => {
    expect(SHIPPED["evards-black-tentacles"].saveDamage).toEqual({ dnd5eactivity000: "none" });
    expect(SHIPPED["black-tentacles"].saveDamage).toEqual({ dnd5eactivity000: "none" });
  });
});
