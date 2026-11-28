import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("Glyph of Warding (SRD 5.2): the explosive rune gets its 6 m Sphere", () => {
  const fixes = CONTENT["glyph-of-warding"].dataFixes;
  const rune = target => ({ effects: [], system: { activities: { dnd5eactivity100: { target } } } });
  it("compendium data: area absent, target inherited from the spell", () => {
    const source = rune({ prompt: true, override: false, template: { units: "ft" }, affects: { choice: false } });
    expect(dataFixPlan(source, fixes).item).toEqual({
      "system.activities.dnd5eactivity100.target.override": true,
      "system.activities.dnd5eactivity100.target.template.type": "sphere",
      "system.activities.dnd5eactivity100.target.template.size": "20",
      "system.activities.dnd5eactivity100.target.affects.type": "creature" });
  });
  it("an area already set (by hand, or by dnd5e) does not move", () => {
    const source = rune({ prompt: true, override: true, template: { units: "ft", type: "cube", size: "10" },
      affects: { choice: false, type: "enemy" } });
    expect(dataFixPlan(source, fixes).fields).toEqual([]);
  });
});
