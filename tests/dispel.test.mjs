import { describe, it, expect } from "vitest";
import { autoDispelLevel, dispelPlan, dispelRule } from "../module/scripts/core/dispel.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("§37.2 : Dissipation de la magie", () => {
  it("cesse d'office jusqu'au niveau 3, ou jusqu'à celui de l'emplacement", () => {
    expect(autoDispelLevel(3)).toBe(3);
    expect(autoDispelLevel(5)).toBe(5);
    expect(autoDispelLevel(undefined)).toBe(3);
  });

  it("au-delà : un test contre DD 10 + niveau", () => {
    expect(dispelPlan([{ key: "a", level: 1 }, { key: "b", level: 3 }, { key: "c", level: 4 }, { key: "d", level: 6 }], 3)).toEqual([
      { key: "a", level: 1, auto: true, dc: null },
      { key: "b", level: 3, auto: true, dc: null },
      { key: "c", level: 4, auto: false, dc: 14 },
      { key: "d", level: 6, auto: false, dc: 16 }
    ]);
    expect(dispelPlan([{ key: "c", level: 4 }, { key: "d", level: 6 }], 5).map(s => s.auto)).toEqual([true, false]);
  });
});

describe("§496 (B16) : dissipation bornée", () => {
  it("la règle déclarée prend une forme unique", () => {
    expect(dispelRule(true)).toEqual({ upTo: null, beyond: "check", keepBySlot: false });
    expect(dispelRule({ upTo: 3, beyond: "none", keepBySlot: true })).toEqual({ upTo: 3, beyond: "none", keepBySlot: true });
    expect(dispelRule({ upTo: 2 })).toEqual({ upTo: 2, beyond: "check", keepBySlot: false });
    expect(dispelRule(undefined)).toBeNull();
    expect(dispelRule(false)).toBeNull();
  });

  it("un plafond fixe, quel que soit l'emplacement ; au-delà, rien sans test", () => {
    const spells = [{ key: "a", level: 2 }, { key: "b", level: 3 }, { key: "c", level: 5 }];
    expect(dispelPlan(spells, 7, { upTo: 3, beyond: "none" })).toEqual([
      { key: "a", level: 2, auto: true, dc: null },
      { key: "b", level: 3, auto: true, dc: null },
      { key: "c", level: 5, auto: false, dc: null, none: true }
    ]);
    expect(dispelPlan(spells, 7, { upTo: 2, beyond: "check" }).map(s => s.dc)).toEqual([null, 13, 15]);
  });

  it("sans règle, la Dissipation de 2024 reste la même", () => {
    expect(dispelPlan([{ key: "c", level: 4 }], 3, dispelRule(true))).toEqual([{ key: "c", level: 4, auto: false, dc: 14 }]);
  });
});

describe("§496 (B16) : la clé `dispel` se valide", () => {
  it("true ou { upTo, beyond?, keepBySlot? }", () => {
    expect(validateEntry({ dispel: true })).toEqual([]);
    expect(validateEntry({ dispel: { upTo: 3, beyond: "none", keepBySlot: true } })).toEqual([]);
    expect(validateEntry({ dispel: { upTo: 0 } })).toEqual([]);
    for ( const bad of [false, 3, {}, { upTo: 10 }, { upTo: 2.5 }, { upTo: 3, beyond: "test" }, { upTo: 3, keepBySlot: false }, { upTo: 3, extra: 1 }] ) {
      expect(validateEntry({ dispel: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});
