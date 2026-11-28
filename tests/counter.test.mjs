import { describe, it, expect } from "vitest";
import { castLevelOf, counterPlan, counterSucceeds, absorbPlan } from "../module/scripts/core/counter.mjs";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
const facts = { "target.seesSource": true };

describe("§66: counterspell the 2014 way", () => {
  it("the casting level: spell level, scaled, slot or linked spell — the highest", () => {
    expect(castLevelOf({ level: 3 })).toBe(3);
    expect(castLevelOf({ level: 3, scaling: 2 })).toBe(5);
    expect(castLevelOf({ level: 3, slotLevel: 6 })).toBe(6);
    expect(castLevelOf({ level: 3, linkedLevel: 4 })).toBe(4);   // Fireball cast at level 4 by an ability
    expect(castLevelOf({ level: 0, slotLevel: null, scaling: undefined })).toBe(0);
    expect(castLevelOf({ level: 2, slotLevel: Number.NaN })).toBe(2);
    expect(castLevelOf()).toBe(0);
  });

  it("up to the counterspell's level, the spell fails without a roll; beyond, check against DC 10 + level", () => {
    expect(counterPlan(5, 5)).toEqual({ castLevel: 5, level: 5, auto: true, dc: null });
    expect(counterPlan(1, 3)).toEqual({ castLevel: 1, level: 3, auto: true, dc: null });
    expect(counterPlan(0, 3).auto).toBe(true);
    expect(counterPlan(6, 5)).toEqual({ castLevel: 6, level: 5, auto: false, dc: 16 });
    expect(counterPlan(9, 3)).toEqual({ castLevel: 9, level: 3, auto: false, dc: 19 });
  });

  it("the successful check (total ≥ DC) dispels the spell; failed or absent, the spell goes through", () => {
    const plan = counterPlan(6, 5);
    expect(counterSucceeds(plan, 16)).toBe(true);
    expect(counterSucceeds(plan, 15)).toBe(false);
    expect(counterSucceeds(plan, null)).toBe(false);
    expect(counterSucceeds(counterPlan(2, 5), null)).toBe(true);
  });

  it("the content: `counter: { level? }`, integer level from 0 to 9", () => {
    const triggers = [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }];
    expect(validateEntry({ counter: { level: 5 }, triggers }, { facts })).toEqual([]);
    expect(validateEntry({ counter: {} }, { facts })).toEqual([]);
    expect(validateEntry({ counter: { level: 10 } }, { facts })[0]).toMatch(/counter/);
    expect(validateEntry({ counter: { level: "5" } }, { facts })[0]).toMatch(/counter/);
    expect(validateEntry({ counter: { level: 5, dc: 12 } }, { facts })[0]).toMatch(/counter/);
    expect(validateEntry({ counter: true }, { facts })[0]).toMatch(/counter/);
    expect(mergeEntries([{ counter: { level: 3 } }, { counter: { level: 5 } }]).counter).toEqual({ level: 5 });
  });
});

describe("§344: absorb a spell that targets only the bearer", () => {
  it("a spell of level 1 or higher, a single target, no area: the activity is played at the spell's level", () => {
    expect(absorbPlan({ castLevel: 3, targets: 1, area: false })).toEqual({ scaling: 2 });
    expect(absorbPlan({ castLevel: 1, targets: 1, area: false })).toEqual({ scaling: 0 });
  });
  it("ni tour de magie, ni plusieurs cibles, ni zone", () => {
    expect(absorbPlan({ castLevel: 0, targets: 1, area: false })).toBeNull();
    expect(absorbPlan({ castLevel: 2, targets: 2, area: false })).toBeNull();
    expect(absorbPlan({ castLevel: 2, targets: 1, area: true })).toBeNull();
  });
  it("the Rod must be able to store the energy; the Staff gains charges with no cap read here", () => {
    expect(absorbPlan({ castLevel: 5, targets: 1, area: false, costs: true, usesLeft: 4 })).toBeNull();
    expect(absorbPlan({ castLevel: 4, targets: 1, area: false, costs: true, usesLeft: 4 })).toEqual({ scaling: 3 });
    expect(absorbPlan({ castLevel: 9, targets: 1, area: false, costs: false, usesLeft: 0 })).toEqual({ scaling: 8 });
  });
  it("the cancel step is allowed at the isTargeted window with a reaction", () => {
    expect(validateEntry({ triggers: [{ on: "isTargeted", do: [{ type: "use", activity: "abcdefghijklmnop" }, { type: "cancel" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use", activity: "abcdefghijklmnop" }, { type: "cancel" }] }] }).length).toBeGreaterThan(0);
  });
});

describe("§345: save on touch under enchantment, condition after the save", () => {
  it("onHit.whileEnchanted et spends", () => {
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", whileEnchanted: "ponmlkjihgfedcba", spends: true } })).toEqual([]);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", spends: true } }).length).toBeGreaterThan(0);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", whileEnchanted: "court" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ onHit: { save: "abcdefghijklmnop", autre: 1 } }).length).toBeGreaterThan(0);
  });
  it("status step with save", () => {
    const entry = save => ({ triggers: [{ on: "hit", do: [{ type: "status", status: "prone", save }] }] });
    expect(validateEntry(entry({ ability: "str", dc: 15 }))).toEqual([]);
    expect(validateEntry(entry({ ability: "force", dc: 15 })).length).toBeGreaterThan(0);
    expect(validateEntry(entry({ ability: "str" })).length).toBeGreaterThan(0);
  });
});

describe("§346: carried light — hood and enchantment", () => {
  const light = extra => ({ carriedLight: { bright: 30, dim: 60, units: "ft", ...extra } });
  it("hooded : { bright, dim }", () => {
    expect(validateEntry(light({ hooded: { bright: 0, dim: 5 } }))).toEqual([]);
    expect(validateEntry(light({ hooded: { dim: 5 } })).length).toBeGreaterThan(0);
    expect(validateEntry(light({ hooded: { bright: 0, dim: 5, angle: 3 } })).length).toBeGreaterThan(0);
  });
  it("whileEnchanted : un id d'effet", () => {
    expect(validateEntry(light({ whileEnchanted: "MHnAqxEXBhUbnjPq" }))).toEqual([]);
    expect(validateEntry(light({ whileEnchanted: "Ablaze" })).length).toBeGreaterThan(0);
  });
});
