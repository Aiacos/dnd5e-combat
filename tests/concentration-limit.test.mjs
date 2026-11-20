import { describe, it, expect } from "vitest";
import {
  CONCENTRATION_LIMIT_KEY, validateConcentrationRule, concentrationRuleOf, concentrationLimitChanges, replacesConcentration
} from "../module/scripts/core/concentration.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { mergeEntries } from "../module/scripts/core/content/merge.mjs";

describe("plusieurs concentrations à la fois (§494, brique B14)", () => {
  it("la clé `concentration` se valide : limite entière de 1 à 20, `loseAll` seulement vrai", () => {
    expect(validateEntry({ concentration: { limit: 3, loseAll: true } })).toEqual([]);
    expect(validateEntry({ concentration: { limit: 2 } })).toEqual([]);
    for ( const bad of [{ limit: 0 }, { limit: 2.5 }, { limit: "3" }, { limit: 21 }, { limit: 3, loseAll: false }, { limit: 3, extra: 1 }, {}, 3, null] ) {
      expect(validateEntry({ concentration: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it("la règle d'une créature : la plus haute limite, « perd tout » si un item le dit", () => {
    expect(concentrationRuleOf([])).toBe(null);
    expect(concentrationRuleOf([null, { triggers: [] }])).toBe(null);
    expect(concentrationRuleOf([{ concentration: { limit: 3, loseAll: true } }])).toEqual({ limit: 3, loseAll: true });
    expect(concentrationRuleOf([{ concentration: { limit: 2 } }, { concentration: { limit: 3 } }])).toEqual({ limit: 3, loseAll: false });
    expect(concentrationRuleOf([{ concentration: { limit: 2, loseAll: true } }, { concentration: { limit: 3 } }])).toEqual({ limit: 3, loseAll: true });
  });

  it("l'effet tenu porte la limite en « upgrade » (une limite de 1 n'a pas besoin d'effet)", () => {
    expect(concentrationLimitChanges({ limit: 3 })).toEqual([{ key: CONCENTRATION_LIMIT_KEY, type: "upgrade", value: "3" }]);
    expect(CONCENTRATION_LIMIT_KEY).toBe("system.attributes.concentration.limit");
    expect(concentrationLimitChanges({ limit: 1 })).toEqual([]);
    expect(concentrationLimitChanges(null)).toEqual([]);
  });

  it("un nouveau sort ne remplace une concentration qu'à la limite, comme dnd5e", () => {
    expect(replacesConcentration(0, 1)).toBe(false);
    expect(replacesConcentration(1, 1)).toBe(true);
    expect(replacesConcentration(1, 3)).toBe(false);
    expect(replacesConcentration(2, 3)).toBe(false);
    expect(replacesConcentration(3, 3)).toBe(true);
    expect(replacesConcentration(2, 0)).toBe(false);          // suivi désactivé
    expect(replacesConcentration(1, undefined)).toBe(false);
  });

  it("une surcouche remplace la règle entière (fusion « replace »)", () => {
    const merged = mergeEntries([{ concentration: { limit: 3, loseAll: true } }, { concentration: { limit: 2 } }]);
    expect(merged.concentration).toEqual({ limit: 2 });
  });
});
