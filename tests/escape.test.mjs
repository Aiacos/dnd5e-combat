import { describe, it, expect } from "vitest";
import { parseEscapeCheck, escapableStatuses } from "../module/scripts/core/escape.mjs";

const known = { abilities: ["str", "dex", "con", "int", "wis", "cha"], skills: ["acr", "ath", "inv", "prc"] };

describe("escaping by a check (§16.54)", () => {
  it("reads the PHB spell enricher (key=value pairs)", () => {
    const text = "<p>Une créature Entravée peut entreprendre une action pour effectuer un test de "
      + "[[/check ability=str skill=ath dc=@attributes.spell.dc]] assorti de votre DD.</p>";
    expect(parseEscapeCheck(text, known)).toEqual({ ability: "str", skill: "ath", dc: "@attributes.spell.dc" });
  });
  it("reads the Monster Manual's bare values, and ignores format=", () => {
    expect(parseEscapeCheck("[[/check ath dc=@skills.ath.passive format=long]]", known))
      .toEqual({ ability: null, skill: "ath", dc: "@skills.ath.passive" });
    expect(parseEscapeCheck("un test de [[/skill ath 10]] pour s'en extraire", known)).toEqual({ ability: null, skill: "ath", dc: "10" });
  });
  it("an ability alone is enough; with no DC or check, nothing", () => {
    expect(parseEscapeCheck("[[/check str 15]]", known)).toEqual({ ability: "str", skill: null, dc: "15" });
    expect(parseEscapeCheck("[[/check ath]]", known)).toBe(null);
    expect(parseEscapeCheck("[[/damage 2d6 fire]]", known)).toBe(null);
    expect(parseEscapeCheck("", known)).toBe(null);
  });
  it("a check written without a DC takes the default DC it is given (imported spell: the caster's spell DC)", () => {
    const spell = { ...known, defaultDc: "@attributes.spell.dc" };
    // DDB Importer, Maximilian's Earthen Grasp: "make a Strength check against your spell save DC".
    expect(parseEscapeCheck("make a [[/check str format=long]] against your spell save DC", spell))
      .toEqual({ ability: "str", skill: null, dc: "@attributes.spell.dc" });
    expect(parseEscapeCheck("[[/check ath]]", spell)).toEqual({ ability: null, skill: "ath", dc: "@attributes.spell.dc" });
    // A written DC wins; without a check, still nothing; the save that precedes it in the text is not a check.
    expect(parseEscapeCheck("[[/check str 15]]", spell)).toEqual({ ability: "str", skill: null, dc: "15" });
    expect(parseEscapeCheck("[[/damage 2d6 fire]]", spell)).toBe(null);
    expect(parseEscapeCheck("[[/save str format=long]] puis [[/check dex format=long]]", spell))
      .toEqual({ ability: "dex", skill: null, dc: "@attributes.spell.dc" });
  });
  it("Restrained without Grappled only (the grapple has its own Escape)", () => {
    expect(escapableStatuses(["restrained"])).toBe(true);
    expect(escapableStatuses(["grappled", "restrained"])).toBe(false);
    expect(escapableStatuses(["poisoned"])).toBe(false);
  });
});
