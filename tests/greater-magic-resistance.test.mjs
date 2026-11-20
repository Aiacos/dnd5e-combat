import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content/enums.mjs";

describe("saveAutoSuccessAgainst : réussite d'office contre la magie (Résistance supérieure à la magie)", () => {
  it("la clé existe et se valide", () => {
    expect(ENTRY_KEYS).toContain("saveAutoSuccessAgainst");
    expect(validateEntry({ saveAutoSuccessAgainst: ["magic"] })).toEqual([]);
    expect(validateEntry({ saveAutoSuccessAgainst: [] })).not.toEqual([]);
    expect(validateEntry({ saveAutoSuccessAgainst: ["poison"] })).not.toEqual([]);
    expect(validateEntry({ saveAutoSuccessAgainst: "magic" })).not.toEqual([]);
  });
  it("le Rakshasa la déclare", () => {
    expect(CONTENT["greater-magic-resistance"].saveAutoSuccessAgainst).toEqual(["magic"]);
    expect(CONTENT["greater-magic-resistance"].spellAttacksMiss).toBe(true);
    expect(validateEntry({ spellAttacksMiss: true })).toEqual([]);
    expect(validateEntry({ spellAttacksMiss: "always" })).not.toEqual([]);
  });
});
