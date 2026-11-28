import { describe, expect, it } from "vitest";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";

// §454: the shape of the compendium data (public SRD 5.2 ids of dnd5e 6.1), with no effect on the item.
const LANDS = [["dnd5eactivity000", "h0xW0mOYF8frKgHf", "fire"], ["aNIM3GrB97GSNZHG", "7YVMASgXswIFXNs2", "cold"],
  ["G1htmQaxEZ0kwRK0", "Gqgjm2NswU6f7qVL", "lightning"], ["0FT3EzkaLnht95Eo", "LKxwXqkEIXJR2XAa", "poison"]];
const broken = () => ({
  name: "Nature's Sanctuary", effects: [],
  system: { identifier: "natures-sanctuary", activities: Object.fromEntries([
    ...LANDS.map(([id]) => [id, { _id: id, type: "utility", effects: LANDS.map(([, e]) => ({ _id: e, level: {} })) }]),
    ["oV51RLBkYFH4MPrS", { _id: "oV51RLBkYFH4MPrS", type: "utility", effects: [] }]]) }
});

describe("Sanctuaire de dame Nature : effets perdus du compendium (dataFixes)", () => {
  const fixes = ITEM_FIXES["natures-sanctuary"].dataFixes;

  it("recreates the four effects, half Cover and terrain Resistance, with their ids", () => {
    const plan = dataFixPlan(broken(), fixes);
    expect(plan.create.map(e => e._id)).toEqual(LANDS.map(([, e]) => e));
    for ( const [, id, type] of LANDS ) {
      const e = plan.create.find(c => c._id === id);
      expect(e.statuses).toEqual(["coverHalf"]);
      expect(e.transfer).toBe(false);
      expect(e.system.changes).toEqual([{ key: "system.traits.dr.value", value: type, priority: null, type: "add" }]);
    }
  });

  it("each activity now applies only its terrain's effect; \"Move\" stays unchanged", () => {
    const plan = dataFixPlan(broken(), fixes);
    for ( const [activity, effect] of LANDS ) expect(plan.item[`system.activities.${activity}.effects`]).toEqual([{ _id: effect }]);
    expect(Object.keys(plan.item).some(k => k.includes("oV51RLBkYFH4MPrS"))).toBe(false);
  });

  it("a hand-edited activity stays as it is, and a second pass does nothing", () => {
    const item = broken();
    item.system.activities.dnd5eactivity000.effects = [{ _id: "h0xW0mOYF8frKgHf" }, { _id: "LKxwXqkEIXJR2XAa" }];
    const plan = dataFixPlan(item, fixes);
    expect(plan.item["system.activities.dnd5eactivity000.effects"]).toBeUndefined();
    const fixed = broken();
    for ( const [path, value] of Object.entries(dataFixPlan(fixed, fixes).item) ) {
      const keys = path.split(".");
      keys.slice(0, -1).reduce((o, k) => o[k], fixed)[keys.at(-1)] = value;
    }
    fixed.effects = dataFixPlan(broken(), fixes).create;
    const again = dataFixPlan(fixed, fixes);
    expect(again.fields).toEqual([]);
  });
});

describe("§456: the corrected data, and the corrected compared reference (no endless replacement)", () => {
  it("withDataFixes returns the corrected data, without touching the source", async () => {
    const { withDataFixes } = await import("../module/scripts/core/data-fixes.mjs");
    const source = broken();
    const { data, fields } = withDataFixes(source, ITEM_FIXES["natures-sanctuary"].dataFixes);
    expect(fields.length).toBe(8);
    expect(data.effects.map(e => e._id)).toEqual(LANDS.map(([, e]) => e));
    expect(data.system.activities.dnd5eactivity000.effects).toEqual([{ _id: "h0xW0mOYF8frKgHf" }]);
    expect(source.effects).toEqual([]);
    expect(source.system.activities.dnd5eactivity000.effects).toHaveLength(4);
    expect(withDataFixes(source, undefined).data).toBe(source);
  });

  it("an item corrected on the sheet no longer looks different from its corrected reference", async () => {
    const { withDataFixes } = await import("../module/scripts/core/data-fixes.mjs");
    const { phbDifferences, phbShape } = await import("../module/scripts/core/phb-update.mjs");
    const fixes = ITEM_FIXES["natures-sanctuary"].dataFixes;
    const onSheet = withDataFixes(broken(), fixes).data;
    expect(phbDifferences(phbShape(onSheet), phbShape(broken())).length).toBeGreaterThan(0);
    expect(phbDifferences(phbShape(onSheet), phbShape(withDataFixes(broken(), fixes).data))).toEqual([]);
  });

  it("Brutal Strike: the orphan id of \"Sundering Blow\" is removed, \"Sundered\" stays", async () => {
    const { BARBARIAN } = await import("../module/scripts/content/barbarian.mjs");
    const { dataFixPlan } = await import("../module/scripts/core/data-fixes.mjs");
    const item = { effects: [{ _id: "Q0ou16II1WEcCdyW" }], system: { activities: { MP1qQsApCj19F2M5: { _id: "MP1qQsApCj19F2M5",
      effects: [{ _id: "tUyuyTQGmpUqMcFe", level: {} }, { _id: "Q0ou16II1WEcCdyW", level: {} }] } } } };
    const plan = dataFixPlan(item, BARBARIAN["brutal-strike"].dataFixes);
    expect(plan.item["system.activities.MP1qQsApCj19F2M5.effects"]).toEqual([{ _id: "Q0ou16II1WEcCdyW" }]);
  });
});
