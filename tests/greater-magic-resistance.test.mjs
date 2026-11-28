import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content/enums.mjs";

describe("saveAutoSuccessAgainst: automatic success against magic (Greater Magic Resistance)", () => {
  it("the key exists and validates", () => {
    expect(ENTRY_KEYS).toContain("saveAutoSuccessAgainst");
    expect(validateEntry({ saveAutoSuccessAgainst: ["magic"] })).toEqual([]);
    expect(validateEntry({ saveAutoSuccessAgainst: [] })).not.toEqual([]);
    expect(validateEntry({ saveAutoSuccessAgainst: ["poison"] })).not.toEqual([]);
    expect(validateEntry({ saveAutoSuccessAgainst: "magic" })).not.toEqual([]);
  });
  it("the Rakshasa declares it", () => {
    expect(CONTENT["greater-magic-resistance"].saveAutoSuccessAgainst).toEqual(["magic"]);
    expect(CONTENT["greater-magic-resistance"].spellAttacksMiss).toBe(true);
    expect(validateEntry({ spellAttacksMiss: true })).toEqual([]);
    expect(validateEntry({ spellAttacksMiss: "always" })).not.toEqual([]);
  });
});
