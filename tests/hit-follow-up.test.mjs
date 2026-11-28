import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

// §373: `hitFollowUp` — after a hit, activities of an item (by identifier) offered for free against the target.
const G = "gggggggggggggggg", S = "ssssssssssssssss";
const use = [{ item: "unarmed-strike", activity: G }, { item: "unarmed-strike", activity: S }];

describe("contenu hitFollowUp", () => {
  it("one or two activities to take, weapon kinds", () => {
    expect(validateEntry({ hitFollowUp: { use } })).toEqual([]);
    expect(validateEntry({ hitFollowUp: { use, choose: 2, weapons: ["unarmed"] } })).toEqual([]);
  });

  it("refuse le reste", () => {
    for ( const bad of [
      {}, { use: [] }, { use: [{ item: "unarmed-strike" }] }, { use: [{ item: "", activity: G }] },
      { use: [{ item: "unarmed-strike", activity: "court" }] }, { use, choose: 0 }, { use, weapons: ["laser"] }, { use, other: true }
    ] ) expect(validateEntry({ hitFollowUp: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });
});
