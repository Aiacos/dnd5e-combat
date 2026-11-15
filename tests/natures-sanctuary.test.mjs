import { describe, expect, it } from "vitest";
import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";

// §454 : la forme de la donnée du compendium (ids publics du SRD 5.2 de dnd5e 6.1), sans aucun effet sur l'item.
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

  it("recrée les quatre effets, abri partiel et Résistance du terrain, avec leurs ids", () => {
    const plan = dataFixPlan(broken(), fixes);
    expect(plan.create.map(e => e._id)).toEqual(LANDS.map(([, e]) => e));
    for ( const [, id, type] of LANDS ) {
      const e = plan.create.find(c => c._id === id);
      expect(e.statuses).toEqual(["coverHalf"]);
      expect(e.transfer).toBe(false);
      expect(e.system.changes).toEqual([{ key: "system.traits.dr.value", value: type, priority: null, type: "add" }]);
    }
  });

  it("chaque activité ne pose plus que l'effet de son terrain ; « Move » ne bouge pas", () => {
    const plan = dataFixPlan(broken(), fixes);
    for ( const [activity, effect] of LANDS ) expect(plan.item[`system.activities.${activity}.effects`]).toEqual([{ _id: effect }]);
    expect(Object.keys(plan.item).some(k => k.includes("oV51RLBkYFH4MPrS"))).toBe(false);
  });

  it("une activité retouchée à la main reste telle quelle, et un second passage ne fait rien", () => {
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

describe("§456 : la donnée corrigée, et la référence comparée corrigée (pas de remplacement sans fin)", () => {
  it("withDataFixes rend la donnée corrigée, sans toucher la source", async () => {
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

  it("un objet corrigé sur la fiche ne paraît plus différent de sa référence corrigée", async () => {
    const { withDataFixes } = await import("../module/scripts/core/data-fixes.mjs");
    const { phbDifferences, phbShape } = await import("../module/scripts/core/phb-update.mjs");
    const fixes = ITEM_FIXES["natures-sanctuary"].dataFixes;
    const onSheet = withDataFixes(broken(), fixes).data;
    expect(phbDifferences(phbShape(onSheet), phbShape(broken())).length).toBeGreaterThan(0);
    expect(phbDifferences(phbShape(onSheet), phbShape(withDataFixes(broken(), fixes).data))).toEqual([]);
  });

  it("Coup brutal : l'id orphelin de « Sundering Blow » est retiré, « Sundered » reste", async () => {
    const { BARBARIAN } = await import("../module/scripts/content/barbarian.mjs");
    const { dataFixPlan } = await import("../module/scripts/core/data-fixes.mjs");
    const item = { effects: [{ _id: "Q0ou16II1WEcCdyW" }], system: { activities: { MP1qQsApCj19F2M5: { _id: "MP1qQsApCj19F2M5",
      effects: [{ _id: "tUyuyTQGmpUqMcFe", level: {} }, { _id: "Q0ou16II1WEcCdyW", level: {} }] } } } };
    const plan = dataFixPlan(item, BARBARIAN["brutal-strike"].dataFixes);
    expect(plan.item["system.activities.MP1qQsApCj19F2M5.effects"]).toEqual([{ _id: "Q0ou16II1WEcCdyW" }]);
  });
});
