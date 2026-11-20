import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("Glyphe de protection (SRD 5.2) : la rune explosive reçoit sa Sphère de 6 m", () => {
  const fixes = CONTENT["glyph-of-warding"].dataFixes;
  const rune = target => ({ effects: [], system: { activities: { dnd5eactivity100: { target } } } });
  it("donnée du compendium : zone absente, cible héritée du sort", () => {
    const source = rune({ prompt: true, override: false, template: { units: "ft" }, affects: { choice: false } });
    expect(dataFixPlan(source, fixes).item).toEqual({
      "system.activities.dnd5eactivity100.target.override": true,
      "system.activities.dnd5eactivity100.target.template.type": "sphere",
      "system.activities.dnd5eactivity100.target.template.size": "20",
      "system.activities.dnd5eactivity100.target.affects.type": "creature" });
  });
  it("une zone déjà réglée (à la main, ou par dnd5e) ne bouge pas", () => {
    const source = rune({ prompt: true, override: true, template: { units: "ft", type: "cube", size: "10" },
      affects: { choice: false, type: "enemy" } });
    expect(dataFixPlan(source, fixes).fields).toEqual([]);
  });
});
