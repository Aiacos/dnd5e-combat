import { describe, it, expect } from "vitest";
import { breaksConcentration } from "../module/scripts/core/concentration-breaker.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("§133 : briseur de concentration — au porteur (true) ou à l'objet qui a blessé (\"item\")", () => {
  it("true : dès que le porteur blesse, quel que soit l'objet", () => {
    expect(breaksConcentration({ owned: [true], item: undefined })).toBe(true);
    expect(breaksConcentration({ owned: [true], item: undefined, itemReady: false })).toBe(true);
  });

  it("\"item\" : seulement si le dégât vient d'une activité de cet objet, prêt à servir", () => {
    // L'acteur possède l'arme, mais frappe avec autre chose : rien.
    expect(breaksConcentration({ owned: ["item"], item: undefined })).toBe(false);
    expect(breaksConcentration({ owned: ["item"], item: true })).toBe(false);
    // Il frappe avec elle.
    expect(breaksConcentration({ owned: ["item"], item: "item", itemReady: true })).toBe(true);
    // Elle n'est pas équipée, ou demande une harmonisation qu'elle n'a pas.
    expect(breaksConcentration({ owned: ["item"], item: "item", itemReady: false })).toBe(false);
  });

  it("sans déclaration : rien", () => {
    expect(breaksConcentration({ owned: [], item: undefined })).toBe(false);
    expect(breaksConcentration({})).toBe(false);
  });

  it("le schéma accepte true et \"item\", rien d'autre", () => {
    expect(validateEntry({ concentrationBreaker: true })).toEqual([]);
    expect(validateEntry({ concentrationBreaker: "item" })).toEqual([]);
    expect(validateEntry({ concentrationBreaker: "weapon" })).toEqual(["concentrationBreaker: true, \"item\" or absent"]);
    expect(validateEntry({ concentrationBreaker: false })).toEqual(["concentrationBreaker: true, \"item\" or absent"]);
  });
});
