import { describe, expect, it } from "vitest";
import { castFixes, dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("spellFixes : ce que l'item corrige dans le sort qu'il lance (Baguette de terreur)", () => {
  const fixes = ITEM_FIXES["wand-of-fear"].spellFixes["9c7SNgBZU2KJjgFg"];
  it("Terreur lancée par la baguette : cône de 18 m au lieu de 9", () => {
    const copy = { effects: [], system: { target: { template: { type: "cone", size: "30", units: "ft" } } } };
    expect(dataFixPlan(copy, castFixes(null, fixes)).item).toEqual({ "system.target.template.size": "60" });
  });
  it("un cône déjà changé (à la main, ou par dnd5e) ne bouge pas", () => {
    const copy = { effects: [], system: { target: { template: { type: "cone", size: "45", units: "ft" } } } };
    expect(dataFixPlan(copy, castFixes(null, fixes)).fields).toEqual([]);
  });
  it("les corrections du sort d'abord, celles de l'item ensuite ; rien des deux : null", () => {
    const own = [{ path: "system.range.units", from: "self", value: "touch" }];
    expect(castFixes(own, fixes)).toEqual([...own, ...fixes]);
    expect(castFixes(own, null)).toEqual(own);
    expect(castFixes(null, null)).toBeNull();
  });
  it("la clé est validée", () => {
    expect(validateEntry({ spellFixes: ITEM_FIXES["wand-of-fear"].spellFixes })).toEqual([]);
    expect(validateEntry({ spellFixes: { short: fixes } })).not.toEqual([]);
    expect(validateEntry({ spellFixes: { "9c7SNgBZU2KJjgFg": [] } })).not.toEqual([]);
  });
});
