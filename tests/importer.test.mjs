/**
 * Diagnostic du monde : les objets importés par Plutonium portent, comme ceux de DDB Importer, leurs activités et leurs effets sous
 * d'autres ids que l'objet officiel (`dnd5eactivity000`, un effet nommé d'après l'objet) — les règles du contenu qui citent les ids
 * officiels ne les trouvent pas. Vu sur un monde d'essai : 152 objets Plutonium dans ce cas. Chaque importeur a sa vérification.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importerOf } from "../module/scripts/core/importer.mjs";

const read = path => readFileSync(new URL(`../module/${path}`, import.meta.url), "utf8");

describe("importerOf — l'importeur d'un objet d'après ses flags", () => {
  it("DDB Importer, Plutonium, ni l'un ni l'autre", () => {
    expect(importerOf({ ddbimporter: { id: 1 } })).toBe("ddb");
    expect(importerOf({ plutonium: { page: "spells.html", source: "XPHB" } })).toBe("plutonium");
    expect(importerOf({ "dnd5e-combat": {} })).toBeNull();
    expect(importerOf({})).toBeNull();
    expect(importerOf(null)).toBeNull();
    expect(importerOf(undefined)).toBeNull();
  });
  it("un objet passé par les deux reste à DDB Importer : jamais compté deux fois", () => {
    expect(importerOf({ plutonium: { page: "items.html" }, ddbimporter: { id: 2 } })).toBe("ddb");
  });
});

describe("la vérification « plutonium » du diagnostic", () => {
  const checks = read("scripts/runtime/diagnostic/checks.mjs");
  it("est déclarée, et dans la liste des vérifications", () => {
    expect(checks).toMatch(/const plutonium = \{\s*id: "plutonium"/);
    expect(checks.slice(checks.indexOf("export const CHECKS"))).toMatch(/\bddb, plutonium,/);
    expect(checks).toContain('importedItemsAtRisk(item => importerOf(item.flags) === "plutonium")');
  });
  it("a son nom et son aide en anglais, en français et en italien", () => {
    for ( const lang of ["en", "fr", "it"] ) {
      const table = JSON.parse(read(`lang/${lang}.json`));
      expect(table["DND5ECOMBAT.Diagnostic.Verif.plutonium.Nom"], lang).toBeTruthy();
      expect(table["DND5ECOMBAT.Diagnostic.Verif.plutonium.Aide"], lang).toBeTruthy();
    }
  });
});
