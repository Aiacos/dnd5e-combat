import { describe, it, expect } from "vitest";
import { manualModeOverride } from "../module/scripts/core/conditions.mjs";

// §480 : un Désavantage du moteur écarté à la main au moment du jet.
describe("Désavantage écarté à la main", () => {
  const dis = { agreed: true, advantage: [], disadvantage: [{ who: "target", key: "unseen" }] };

  it("jet normal : écarté ; à l'Avantage : remplacé ; au Désavantage : rien", () => {
    expect(manualModeOverride(dis, { advantageMode: 0 })).toBe("cancelled");
    expect(manualModeOverride(dis, { advantageMode: 1 })).toBe("replaced");
    expect(manualModeOverride(dis, { advantageMode: -1 })).toBe(null);
  });
  it("une vraie source d'Avantage (options.advantage) : le jet normal est la règle", () => {
    expect(manualModeOverride(dis, { advantage: true, disadvantage: true, advantageMode: 0 })).toBe(null);
  });
  it("rien sans Désavantage du moteur, avec un Avantage du moteur, ou des cibles qui ne s'accordent pas", () => {
    expect(manualModeOverride({ agreed: true, advantage: [], disadvantage: [] }, { advantageMode: 1 })).toBe(null);
    expect(manualModeOverride({ ...dis, advantage: [{ who: "attacker", key: "unseen" }] }, { advantageMode: 0 })).toBe(null);
    expect(manualModeOverride({ ...dis, agreed: false }, { advantageMode: 0 })).toBe(null);
    expect(manualModeOverride(null, { advantageMode: 0 })).toBe(null);
    expect(manualModeOverride(dis, null)).toBe(null);
  });
});
