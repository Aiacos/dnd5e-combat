import { describe, expect, it } from "vitest";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content/enums.mjs";

describe("noTeleport: the bearer of an item effect does not teleport (Dimensional Shackles)", () => {
  it("the key exists and validates (true or absent)", () => {
    expect(ENTRY_KEYS).toContain("noTeleport");
    expect(validateEntry({ noTeleport: true })).toEqual([]);
    expect(validateEntry({ noTeleport: "yes" })).not.toEqual([]);
  });
  it("Dimensional Shackles declare it", () => {
    expect(ITEM_FIXES["dimensional-shackles"]).toEqual({ noTeleport: true });
  });
});
