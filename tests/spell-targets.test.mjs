import { describe, expect, it } from "vitest";
import { castTargetRule, typeAllowed } from "../module/scripts/core/eligibility.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("spellTargets : ce que l'item qui lance un sort dit de ses cibles (Anneau d'influence animale)", () => {
  const ring = ITEM_FIXES["ring-of-animal-influence"].spellTargets;
  it("Terreur lancée par l'anneau : les Bêtes seulement", () => {
    const rule = castTargetRule(null, ring, "kn4eCuLZrcps7ujc");
    expect(rule).toEqual({ types: ["beast"] });
    expect(typeAllowed(rule.types, "beast")).toBe(true);
    expect(typeAllowed(rule.types, "undead")).toBe(false);
  });
  it("les autres sorts de l'anneau, ou le sort lancé autrement : la règle du sort, inchangée", () => {
    expect(castTargetRule(null, ring, "Y0cSjJs5olZWdSgZ")).toBeNull();
    expect(castTargetRule({ types: ["humanoid"] }, ring, null)).toEqual({ types: ["humanoid"] });
    expect(castTargetRule({ types: ["humanoid"] }, undefined, "kn4eCuLZrcps7ujc")).toEqual({ types: ["humanoid"] });
  });
  it("ce que l'item déclare l'emporte, clé par clé", () => {
    const own = { types: ["humanoid"], unaffectedIf: { "target.hasStatus": "deafened" } };
    expect(castTargetRule(own, ring, "kn4eCuLZrcps7ujc"))
      .toEqual({ types: ["beast"], unaffectedIf: { "target.hasStatus": "deafened" } });
  });
  it("la clé est validée", () => {
    expect(validateEntry({ spellTargets: ring })).toEqual([]);
    expect(validateEntry({ spellTargets: { tooShort: { types: ["beast"] } } })).not.toEqual([]);
    expect(validateEntry({ spellTargets: { kn4eCuLZrcps7ujc: { types: ["animal"] } } })).not.toEqual([]);
  });
});

describe("spellTargets: the Trident of Fish Command, a Beast that has a Swim Speed", () => {
  const trident = ITEM_FIXES["trident-of-fish-command"].spellTargets;
  it("the rule adds to the spell's: unaffected without a Swim Speed", () => {
    const rule = castTargetRule({ types: ["beast"] }, trident, "ANM9wvqTFJSH2o11");
    expect(rule).toEqual({ types: ["beast"], unaffectedIf: { not: { "target.hasSpeed": "swim" } } });
    const swims = { "target.hasSpeed": mode => mode === "swim" };
    const walks = { "target.hasSpeed": () => false };
    expect(holds(rule.unaffectedIf, swims)).toBe(false);
    expect(holds(rule.unaffectedIf, walks)).toBe(true);
  });
  it("the entry is valid, the fact known to the engine", () => {
    expect(validateEntry({ spellTargets: trident }, { facts: { "target.hasSpeed": () => true } })).toEqual([]);
  });
});

