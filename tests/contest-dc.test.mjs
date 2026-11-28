import { describe, expect, it } from "vitest";
import { checkOutcome } from "../module/scripts/core/contest.mjs";
import { declaredEscapeCheck } from "../module/scripts/core/escape.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("contest.dc: a check against a fixed DC places the effect (Chain, Rope)", () => {
  it("a success at the DC or more", () => {
    expect(checkOutcome(13, 13)).toBe("win");
    expect(checkOutcome(18, 13)).toBe("win");
    expect(checkOutcome(12, 13)).toBe("lose");
    expect(checkOutcome(NaN, 13)).toBe("lose");
  });
  it("the key is valid with `dc` or with `against`, not with both", () => {
    const base = { skill: "ath", effect: "dasChainBound000" };
    expect(validateEntry({ contest: { ...base, dc: 13 } })).toEqual([]);
    expect(validateEntry({ contest: { ...base, against: ["acr"] } })).toEqual([]);
    expect(validateEntry({ contest: { ...base, dc: 13, against: ["acr"] } })).not.toEqual([]);
    expect(validateEntry({ contest: { ...base } })).not.toEqual([]);
  });
  it("Chain: Athletics DC 13; Rope: Sleight of Hand DC 10; the Restrained effect is created and linked to the activity", () => {
    expect(CONTENT.chain.contest).toEqual({ activity: "nkqvEiPdXCyiJ9ub", skill: "ath", dc: 13, effect: "dasChainBound000" });
    expect(CONTENT.rope.contest).toEqual({ activity: "Y0LvyxjfVHNbp4CG", skill: "slt", dc: 10, effect: "dasRopeBound0000" });
    const item = { effects: [], system: { activities: { nkqvEiPdXCyiJ9ub: { effects: [] } } } };
    const plan = dataFixPlan(item, CONTENT.chain.dataFixes);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0]).toMatchObject({ _id: "dasChainBound000", statuses: ["restrained"], transfer: false });
    expect(plan.item).toEqual({ "system.activities.nkqvEiPdXCyiJ9ub.effects": [{ _id: "dasChainBound000" }] });
  });
});

describe("escapeCheck: the check that frees the bound creature, declared by the entry", () => {
  it("Chain: Acrobatics DC 18; Rope: Acrobatics DC 15", () => {
    expect(declaredEscapeCheck(CONTENT.chain)).toEqual({ ability: null, skill: "acr", dc: "18" });
    expect(declaredEscapeCheck(CONTENT.rope)).toEqual({ ability: null, skill: "acr", dc: "15" });
  });
  it("an ability, or a formula for the DC; nothing declared: null", () => {
    expect(declaredEscapeCheck({ escapeCheck: { ability: "str", dc: "@attributes.spell.dc" } }))
      .toEqual({ ability: "str", skill: null, dc: "@attributes.spell.dc" });
    expect(declaredEscapeCheck({})).toBeNull();
    expect(declaredEscapeCheck(null)).toBeNull();
  });
  it("the key asks for an ability or a skill, and a DC", () => {
    expect(validateEntry({ escapeCheck: { skill: "acr", dc: 18 } })).toEqual([]);
    expect(validateEntry({ escapeCheck: { ability: "dex", dc: "@attributes.spell.dc" } })).toEqual([]);
    expect(validateEntry({ escapeCheck: { dc: 18 } })).not.toEqual([]);
    expect(validateEntry({ escapeCheck: { skill: "acr" } })).not.toEqual([]);
    expect(validateEntry({ escapeCheck: { skill: "acrobatics", dc: 18 } })).not.toEqual([]);
    expect(validateEntry({ escapeCheck: { skill: "acr", dc: 18, burst: 20 } })).not.toEqual([]);
  });
});
