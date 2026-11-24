import { describe, expect, it } from "vitest";
import { linkHolds, validateCastFromBearer } from "../module/scripts/core/cast-from-bearer.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";

describe("castFromBearer: casting from the linked creature's space (Gaze of Two Minds)", () => {
  const entry = CONTENT["gaze-of-two-minds"];
  it("the link holds within 60 ft", () => {
    expect(entry.castFromBearer).toEqual({ distance: 60, units: "ft" });
    expect(linkHolds(60, 60)).toBe(true);
    expect(linkHolds(25, 60)).toBe(true);
    expect(linkHolds(65, 60)).toBe(false);
    expect(linkHolds(NaN, 60)).toBe(false);
  });
  it("held by a marker on the touched creature until the end of the caster's next turn; the activity is a touch", () => {
    const source = { effects: [], system: { activities: { TqjZeWzJpT25ZX8s: { effects: [], range: { units: "ft", value: "60" } } } } };
    const plan = dataFixPlan(source, entry.dataFixes);
    expect(plan.create[0]).toMatchObject({ _id: "dasGazeTwoMinds0", name: "Gaze of Two Minds" });
    expect(plan.item).toEqual({ "system.activities.TqjZeWzJpT25ZX8s.effects": [{ _id: "dasGazeTwoMinds0" }],
      "system.activities.TqjZeWzJpT25ZX8s.range.units": "touch" });
    expect(entry.effectEnds).toEqual({ dasGazeTwoMinds0: "casterTurnEnd" });
  });
  it("the key is validated", () => {
    expect(validateCastFromBearer(entry.castFromBearer, "")).toEqual([]);
    expect(validateCastFromBearer({ distance: 0, units: "ft" }, "")).toHaveLength(1);
    expect(validateCastFromBearer({ distance: 60 }, "")).toHaveLength(1);
    expect(validateEntry(entry)).toEqual([]);
  });
});
