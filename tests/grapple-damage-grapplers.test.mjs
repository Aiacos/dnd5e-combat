/**
 * §132 : `grappleDamage` — `grapplers: true` étend les dégâts de début de tour aux créatures qui agrippent l'auteur (Peau barbelée
 * du Diable barbelé, SRD 5.2 : « toute créature qu'il agrippe ou qui l'agrippe »).
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("grappleDamage : les créatures qui agrippent l'auteur", () => {
  it("le schéma accepte `grapplers: true` et rien d'autre", () => {
    const rule = { formula: "1d10", damageType: "piercing" };
    expect(validateEntry({ grappleDamage: rule })).toEqual([]);
    expect(validateEntry({ grappleDamage: { ...rule, grapplers: true } })).toEqual([]);
    expect(validateEntry({ grappleDamage: { ...rule, grapplers: false } })).toHaveLength(1);
    expect(validateEntry({ grappleDamage: { ...rule, grapplers: "all" } })).toHaveLength(1);
    expect(validateEntry({ grappleDamage: { ...rule, to: "both" } })).toHaveLength(1);
  });
  it("la Peau barbelée est livrée ; le Combat à mains nues ne change pas", () => {
    expect(CONTENT["barbed-hide"].grappleDamage).toEqual({ formula: "1d10", damageType: "piercing", grapplers: true });
    expect(validateEntry(CONTENT["barbed-hide"], { at: "barbed-hide." })).toEqual([]);
    expect(CONTENT["unarmed-fighting"].grappleDamage).toEqual({ formula: "1d4", damageType: "bludgeoning" });
  });
});
