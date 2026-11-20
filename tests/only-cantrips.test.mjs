import { describe, it, expect } from "vitest";
import { validateEntry, mergeEntries } from "../module/scripts/core/content.mjs";
import { checkUse, freshBudget, onlyCantripsIssue } from "../module/scripts/core/turn.mjs";

const A = "aaaaaaaaaaaaaaaa";

describe("§503 (B23) : plus de sort ce tour, sauf un sort mineur", () => {
  it("schéma : afterUse { onlyCantrips, activity? }", () => {
    expect(validateEntry({ afterUse: { onlyCantrips: true } })).toEqual([]);
    expect(validateEntry({ afterUse: { onlyCantrips: { castTime: "action" }, activity: A } })).toEqual([]);
    expect(validateEntry({ afterUse: { onlyCantrips: { castTime: "minute" } } })).toEqual([expect.stringContaining("onlyCantrips")]);
    expect(validateEntry({ afterUse: { onlyCantrips: false } })).toEqual([expect.stringContaining("onlyCantrips")]);
    expect(validateEntry({ afterUse: { activity: A } })).toEqual([expect.stringContaining("afterUse")]);
    expect(validateEntry({ afterUse: { onlyCantrips: true, activity: "court" } })).toEqual([expect.stringContaining("afterUse.activity")]);
    expect(validateEntry({ afterUse: { onlyCantrips: true, autre: 1 } })).toEqual([expect.stringContaining("unknown key")]);
    expect(mergeEntries([null, { afterUse: { onlyCantrips: true } }]).afterUse).toEqual({ onlyCantrips: true });
  });
  it("le refus : un sort à niveau, ou un sort mineur d'un autre temps d'incantation", () => {
    const rule = { castTime: "action" };
    expect(onlyCantripsIssue(rule, { level: 1 }, "action")).toBe("onlyCantripsAction");
    expect(onlyCantripsIssue(rule, { level: 0 }, "bonus")).toBe("onlyCantripsAction");
    expect(onlyCantripsIssue(rule, { level: 0 }, "action")).toBe(null);
    expect(onlyCantripsIssue(rule, null, "action")).toBe(null);   // une arme, une capacité : pas un sort
    expect(onlyCantripsIssue({ castTime: null }, { level: 0 }, "bonus")).toBe(null);
    expect(onlyCantripsIssue({ castTime: null }, { level: 2 }, "bonus")).toBe("onlyCantrips");
    expect(onlyCantripsIssue({ castTime: "bonus" }, { level: 3 }, "bonus")).toBe("onlyCantripsBonus");
  });
  it("dans le budget du tour : seulement à son tour, et pas avant la capacité", () => {
    const budget = { ...freshBudget(), onlyCantrips: { castTime: "action", item: "Essai" } };
    const spell = level => ({ cost: "action", weaponAttack: false, usesSpellSlot: level > 0, spell: { level } });
    expect(checkUse(budget, spell(1), { isOwnTurn: true })).toContain("onlyCantripsAction");
    expect(checkUse(budget, spell(0), { isOwnTurn: true })).toEqual([]);
    expect(checkUse(freshBudget(), spell(1), { isOwnTurn: true })).toEqual([]);
    expect(freshBudget().onlyCantrips).toBe(null);
  });
});
