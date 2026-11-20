import { describe, expect, it } from "vitest";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content/enums.mjs";

describe("noTeleport : le porteur d'un effet de l'item ne se téléporte pas (Entraves dimensionnelles)", () => {
  it("la clé existe et se valide (true ou absente)", () => {
    expect(ENTRY_KEYS).toContain("noTeleport");
    expect(validateEntry({ noTeleport: true })).toEqual([]);
    expect(validateEntry({ noTeleport: "yes" })).not.toEqual([]);
  });
  it("Entraves dimensionnelles la déclarent", () => {
    expect(ITEM_FIXES["dimensional-shackles"]).toEqual({ noTeleport: true });
  });
});
