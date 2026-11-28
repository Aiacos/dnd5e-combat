import { describe, it, expect } from "vitest";
import { manualModeOverride } from "../module/scripts/core/conditions.mjs";

// §480: an engine Disadvantage dismissed by hand at the time of the roll.
describe("Disadvantage dismissed by hand", () => {
  const dis = { agreed: true, advantage: [], disadvantage: [{ who: "target", key: "unseen" }] };

  it("normal roll: dismissed; at Advantage: replaced; at Disadvantage: nothing", () => {
    expect(manualModeOverride(dis, { advantageMode: 0 })).toBe("cancelled");
    expect(manualModeOverride(dis, { advantageMode: 1 })).toBe("replaced");
    expect(manualModeOverride(dis, { advantageMode: -1 })).toBe(null);
  });
  it("a true source of Advantage (options.advantage): the normal roll is the rule", () => {
    expect(manualModeOverride(dis, { advantage: true, disadvantage: true, advantageMode: 0 })).toBe(null);
  });
  it("nothing without an engine Disadvantage, with an engine Advantage, or with targets that disagree", () => {
    expect(manualModeOverride({ agreed: true, advantage: [], disadvantage: [] }, { advantageMode: 1 })).toBe(null);
    expect(manualModeOverride({ ...dis, advantage: [{ who: "attacker", key: "unseen" }] }, { advantageMode: 0 })).toBe(null);
    expect(manualModeOverride({ ...dis, agreed: false }, { advantageMode: 0 })).toBe(null);
    expect(manualModeOverride(null, { advantageMode: 0 })).toBe(null);
    expect(manualModeOverride(dis, null)).toBe(null);
  });
});
