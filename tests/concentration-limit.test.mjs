import { describe, it, expect } from "vitest";
import {
  CONCENTRATION_LIMIT_KEY, validateConcentrationRule, concentrationRuleOf, concentrationLimitChanges, replacesConcentration
} from "../module/scripts/core/concentration.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { mergeEntries } from "../module/scripts/core/content/merge.mjs";

describe("several Concentrations at once (§494, brick B14)", () => {
  it("the `concentration` key is validated: integer limit from 1 to 20, `loseAll` only true", () => {
    expect(validateEntry({ concentration: { limit: 3, loseAll: true } })).toEqual([]);
    expect(validateEntry({ concentration: { limit: 2 } })).toEqual([]);
    for ( const bad of [{ limit: 0 }, { limit: 2.5 }, { limit: "3" }, { limit: 21 }, { limit: 3, loseAll: false }, { limit: 3, extra: 1 }, {}, 3, null] ) {
      expect(validateEntry({ concentration: bad }).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it("a creature's rule: the highest limit, \"loses all\" if an item says so", () => {
    expect(concentrationRuleOf([])).toBe(null);
    expect(concentrationRuleOf([null, { triggers: [] }])).toBe(null);
    expect(concentrationRuleOf([{ concentration: { limit: 3, loseAll: true } }])).toEqual({ limit: 3, loseAll: true });
    expect(concentrationRuleOf([{ concentration: { limit: 2 } }, { concentration: { limit: 3 } }])).toEqual({ limit: 3, loseAll: false });
    expect(concentrationRuleOf([{ concentration: { limit: 2, loseAll: true } }, { concentration: { limit: 3 } }])).toEqual({ limit: 3, loseAll: true });
  });

  it("the held effect carries the limit as \"upgrade\" (a limit of 1 needs no effect)", () => {
    expect(concentrationLimitChanges({ limit: 3 })).toEqual([{ key: CONCENTRATION_LIMIT_KEY, type: "upgrade", value: "3" }]);
    expect(CONCENTRATION_LIMIT_KEY).toBe("system.attributes.concentration.limit");
    expect(concentrationLimitChanges({ limit: 1 })).toEqual([]);
    expect(concentrationLimitChanges(null)).toEqual([]);
  });

  it("a new spell replaces a Concentration only at the limit, like dnd5e", () => {
    expect(replacesConcentration(0, 1)).toBe(false);
    expect(replacesConcentration(1, 1)).toBe(true);
    expect(replacesConcentration(1, 3)).toBe(false);
    expect(replacesConcentration(2, 3)).toBe(false);
    expect(replacesConcentration(3, 3)).toBe(true);
    expect(replacesConcentration(2, 0)).toBe(false);          // tracking disabled
    expect(replacesConcentration(1, undefined)).toBe(false);
  });

  it("an overlay replaces the whole rule (\"replace\" merge)", () => {
    const merged = mergeEntries([{ concentration: { limit: 3, loseAll: true } }, { concentration: { limit: 2 } }]);
    expect(merged.concentration).toEqual({ limit: 2 });
  });
});
