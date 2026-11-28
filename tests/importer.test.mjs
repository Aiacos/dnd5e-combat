/**
 * World diagnostic: an importer's items may carry their activities and effects under ids other than the official item's
 * (§245) — true of DDB Importer, which the engine knows, and of other importers, which a companion module declares
 * (`api.diagnostic.registerImporter`). The engine names no other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DDB_IMPORTER, importerErrors, importerOf } from "../module/scripts/core/importer.mjs";

const read = path => readFileSync(new URL(`../module/${path}`, import.meta.url), "utf8");
const other = { id: "other-importer", flag: "otherimporter", name: "Items imported by Other" };

describe("importerOf — the importer of an item from its flags", () => {
  it("DDB Importer with nothing declared; a declared importer; neither", () => {
    expect(importerOf({ ddbimporter: { id: 1 } })).toBe("ddb");
    expect(importerOf({ otherimporter: { page: "spells" } })).toBeNull();
    expect(importerOf({ otherimporter: { page: "spells" } }, [other])).toBe("other-importer");
    expect(importerOf({ "dnd5e-combat": {} }, [other])).toBeNull();
    expect(importerOf({}, [other])).toBeNull();
    expect(importerOf(null, [other])).toBeNull();
    expect(importerOf(undefined)).toBeNull();
  });
  it("an item passed through two importers is counted only once: by DDB Importer, then in declaration order", () => {
    expect(importerOf({ otherimporter: {}, ddbimporter: { id: 2 } }, [other])).toBe("ddb");
    const second = { id: "second", flag: "second" };
    expect(importerOf({ otherimporter: {}, second: {} }, [other, second])).toBe("other-importer");
    expect(importerOf({ otherimporter: {}, second: {} }, [second, other])).toBe("second");
  });
});

describe("importerErrors — an importer's declaration", () => {
  it("a good declaration: nothing", () => {
    expect(importerErrors(other)).toEqual([]);
    expect(importerErrors({ ...other, hint: "Help", icon: "fa-solid fa-file-import" })).toEqual([]);
  });
  it("id, flag and name are required, in the right shape", () => {
    expect(importerErrors(null).length).toBe(1);
    expect(importerErrors({ ...other, id: "Other Importer" }).join()).toMatch(/^id:/);
    expect(importerErrors({ ...other, flag: "" }).join()).toMatch(/^flag:/);
    expect(importerErrors({ ...other, name: "  " }).join()).toMatch(/^name:/);
    expect(importerErrors({ ...other, hint: 3 }).join()).toMatch(/^hint:/);
  });
  it("neither DDB Importer's id nor flag, nor those of an already declared importer", () => {
    expect(importerErrors({ ...other, id: DDB_IMPORTER.id }).join()).toMatch(/already taken/);
    expect(importerErrors({ ...other, flag: DDB_IMPORTER.flag }).join()).toMatch(/already belongs to "ddb"/);
    expect(importerErrors({ ...other, id: "again" }, [other]).join()).toMatch(/already belongs to "other-importer"/);
    expect(importerErrors({ ...other, flag: "again" }, [other]).join()).toMatch(/already taken/);
  });
});

describe("le moteur ne nomme que DDB Importer", () => {
  it("no other importer in the diagnostic code, its translations, or the API", () => {
    const sources = ["scripts/core/importer.mjs", "scripts/runtime/diagnostic/checks.mjs", "scripts/runtime/diagnostic/index.mjs",
      "scripts/ui/diagnostic.mjs", "lang/en.json", "lang/fr.json", "lang/it.json"].map(read).join("\n");
    expect(sources).not.toMatch(/plutonium/i);
  });
  it("the check of a declared importer carries its own name and its own help", () => {
    const ui = read("scripts/ui/diagnostic.mjs");
    expect(ui).toContain("check.name ?? loc(`Diagnostic.Verif.${check.id}.Nom`)");
    expect(ui).toContain("check.hint ?? loc(`Diagnostic.Verif.${check.id}.Aide`)");
    expect(read("scripts/dnd5e-combat.mjs")).toContain("registerImporter, unregisterImporter })");
  });
});
