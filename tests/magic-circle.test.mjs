import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("Magic Circle (SRD 5.2): what the area gives to whoever stands in it", () => {
  const entry = CONTENT["magic-circle"];
  const types = ["celestial", "elemental", "fey", "fiend", "undead"];
  it("a mark placed by the area, with no save on placement", () => {
    expect(entry.quietPose).toBe(true);
    expect(entry.zoneEffects).toBe(true);
    const plan = dataFixPlan({ effects: [], system: { activities: { dnd5eactivity000: { effects: [] } } } }, entry.dataFixes);
    expect(plan.create[0]).toMatchObject({ _id: "dasMagicCircle00", statuses: [], transfer: false });
    expect(plan.item).toEqual({ "system.activities.dnd5eactivity000.effects": [{ _id: "dasMagicCircle00" }] });
  });
  it("Disadvantage on attack rolls of the five types against whoever bears the mark", () => {
    const [rule] = entry.triggers;
    expect(rule.on).toBe("preAttackRoll");
    expect(rule.do).toEqual([{ type: "disadvantage" }]);
    const facts = (type, inside) => ({ "target.hasEffect": id => inside && (id === "magic-circle"), "source.creatureType": type });
    for ( const t of types ) expect(holds(rule.if, facts(t, true))).toBe(true);
    expect(holds(rule.if, facts("giant", true))).toBe(false);
    expect(holds(rule.if, facts("fiend", false))).toBe(false);
  });
  it("neither Charmed nor Frightened by those types", () => {
    expect(entry.wardsConditions).toEqual({ types, statuses: ["charmed", "frightened"] });
  });
  it("the entry is valid", () => {
    expect(validateEntry(entry, { facts: { "target.hasEffect": true, "source.creatureType": true } })).toEqual([]);
  });
});
