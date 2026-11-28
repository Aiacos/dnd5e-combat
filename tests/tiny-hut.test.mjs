import { describe, expect, it } from "vitest";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("Tiny Hut (SRD 5.2): spells of level 3 or lower do not enter it", () => {
  const entry = CONTENT["tiny-hut"];
  it("the globe of Globe of Invulnerability, at level 3, inside the 3 m Emanation", () => {
    expect(entry.globe).toEqual({ radius: 10, units: "ft", maxLevel: 3 });
    expect(CONTENT["globe-of-invulnerability"].globe.maxLevel).toBe(5);
  });
  it("held by a mark on the caster: created, linked to the activity, placed on oneself", () => {
    expect(entry.ranges).toEqual({ dnd5eactivity000: { units: "self" } });
    const plan = dataFixPlan({ effects: [], system: { activities: { dnd5eactivity000: { effects: [] } } } }, entry.dataFixes);
    expect(plan.create[0]).toMatchObject({ _id: "dasTinyHut000000", name: "Tiny Hut", duration: { value: 8, units: "hours" } });
    expect(plan.item).toEqual({ "system.activities.dnd5eactivity000.effects": [{ _id: "dasTinyHut000000" }] });
  });
  it("the entry is valid", () => {
    expect(validateEntry(entry)).toEqual([]);
  });
});
