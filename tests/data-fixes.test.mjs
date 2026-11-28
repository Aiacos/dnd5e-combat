import { describe, it, expect } from "vitest";
import { dataFixPlan, planIsEmpty, matchesFrom, validateDataFixes } from "../module/scripts/core/data-fixes.mjs";
import { ITEM_FIXES } from "../module/scripts/content/item-fixes.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const ACT = "aaaaaaaaaaaaaaa1";
const FX = "bbbbbbbbbbbbbbb1";
const source = () => ({
  name: "Wand", system: {
    uses: { max: "", recovery: [], spent: 0 },
    activities: { [ACT]: { _id: ACT, activation: { type: "special", override: false }, consumption: { targets: [{ type: "activityUses", value: "2", target: "", scaling: { mode: "" } }] } } }
  },
  effects: [{ _id: FX, name: "Oops", transfer: true, disabled: true, system: { changes: [{ key: "system.traits.dr.value", value: "bludegoning", priority: null, type: "add" }] } }]
});

describe("fixes to the premium data (§335)", () => {
  it("fixes an activity, item and effect field, and creates the missing effect", () => {
    const plan = dataFixPlan(source(), [
      { path: `system.activities.${ACT}.activation.type`, from: "special", value: "action" },
      { path: "system.uses.max", from: "", value: "7" },
      { effect: FX, path: "disabled", from: true, value: false },
      { effect: "ccccccccccccccc1", create: { name: "New", type: "base", transfer: true } }
    ]);
    expect(plan.item).toEqual({ [`system.activities.${ACT}.activation.type`]: "action", "system.uses.max": "7" });
    expect(plan.effects).toEqual([{ _id: FX, disabled: false }]);
    expect(plan.create).toEqual([{ name: "New", type: "base", transfer: true, _id: "ccccccccccccccc1" }]);
    expect(plan.fields).toHaveLength(4);
  });

  it("leaves a hand-modified value, a missing activity and what is already right", () => {
    const edited = source();
    edited.system.uses.max = "3";
    const plan = dataFixPlan(edited, [
      { path: "system.uses.max", from: "", value: "7" },
      { path: "system.activities.zzzzzzzzzzzzzzz1.activation.type", value: "action" },
      { path: `system.activities.${ACT}.activation.override`, value: false },
      { effect: FX, create: { name: "Already there" } }
    ]);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("compares the origin on the declared keys only (dnd5e completes the data)", () => {
    const plan = dataFixPlan(source(), [{ path: `system.activities.${ACT}.consumption.targets`,
      from: [{ type: "activityUses", value: "2" }], value: [{ type: "itemUses", value: "2", target: "", scaling: {} }] }]);
    expect(Object.keys(plan.item)).toEqual([`system.activities.${ACT}.consumption.targets`]);
    expect(matchesFrom([{ a: 1, b: 2 }], [{ a: 1 }])).toBe(true);
    expect(matchesFrom([{ a: 1 }, { a: 2 }], [{ a: 1 }])).toBe(false);
    expect(matchesFrom("", null)).toBe(false);
  });

  it("treats an unsaved null field as null, and adds a whole activity", () => {
    const src = source();
    src.system.activities[ACT].spell = { challenge: { override: false } };
    const plan = dataFixPlan(src, [
      { path: `system.activities.${ACT}.spell.challenge`, from: { attack: null, save: null, override: false }, value: { attack: null, save: 18, override: true } },
      { path: "system.activities.dasReloadAction0", value: { _id: "dasReloadAction0", type: "utility" } }
    ]);
    expect(Object.keys(plan.item)).toEqual([`system.activities.${ACT}.spell.challenge`, "system.activities.dasReloadAction0"]);
    src.system.activities.dasReloadAction0 = { _id: "dasReloadAction0", type: "utility", name: "", activation: {} };
    expect(Object.keys(dataFixPlan(src, [{ path: "system.activities.dasReloadAction0", value: { _id: "dasReloadAction0", type: "utility" } }]).item)).toEqual([]);
  });

  it("rewrites a changes array in full", () => {
    const fixed = [{ key: "system.traits.dr.value", value: "bludgeoning", priority: null, type: "add" }];
    const plan = dataFixPlan(source(), [{ effect: FX, path: "system.changes",
      from: [{ key: "system.traits.dr.value", value: "bludegoning", priority: null, type: "add" }], value: fixed }]);
    expect(plan.effects).toEqual([{ _id: FX, "system.changes": fixed }]);
    // Applied a second time: nothing to do.
    const after = source();
    after.effects[0].system.changes = fixed;
    expect(planIsEmpty(dataFixPlan(after, [{ effect: FX, path: "system.changes", value: fixed }]))).toBe(true);
  });

  it("validates the key", () => {
    expect(validateDataFixes([{ path: "system.uses.max", value: "1" }])).toEqual([]);
    expect(validateDataFixes([{ effect: FX, create: { name: "x" } }])).toEqual([]);
    expect(validateDataFixes([{ path: "flags.x", value: 1 }])).toHaveLength(1);
    expect(validateDataFixes([{ effect: "short", path: "disabled", value: false }])).toHaveLength(1);
    expect(validateDataFixes([])).toHaveLength(1);
  });

  it("every shipped fix targets a 16-character id and declares its origin or creates an effect", () => {
    for ( const [id, entry] of Object.entries(CONTENT) ) {
      for ( const fix of entry.dataFixes ?? [] ) {
        expect(validateDataFixes([fix]), id).toEqual([]);
        const activity = fix.path?.match(/^system\.activities\.([^.]+)/)?.[1];
        if ( activity ) expect(activity, id).toMatch(/^[A-Za-z0-9]{16}$/);
        const adds = /^system\.activities\.das[A-Za-z0-9]{13}$/.test(fix.path ?? "");
        expect(("from" in fix) || ("create" in fix) || adds, `${id} ${fix.path}`).toBe(true);
      }
    }
  });
});

describe("table des corrections d'objets (§335–§338)", () => {
  it("never declares the same identifier twice (the second would overwrite the first)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../module/scripts/content/item-fixes.mjs", import.meta.url), "utf8");
    const keys = [...src.matchAll(/^  "([a-z0-9-]+)": /gm)].map(m => m[1]);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});

describe("dataFixes: an effect that the module has added since (`unless`)", () => {
  const BOOK = "RcwWrY6u4OPM5qZl";
  const fix = ITEM_FIXES["robe-of-stars"].dataFixes;
  it("Robe of Stars: created when the item does not have its own, not when it already has it", () => {
    expect(dataFixPlan({ effects: [], system: {} }, fix).create).toHaveLength(1);
    expect(dataFixPlan({ effects: [{ _id: BOOK }], system: {} }, fix).create).toEqual([]);
  });
  it("Staff of Power: likewise", () => {
    const staff = ITEM_FIXES["staff-of-power"].dataFixes;
    expect(dataFixPlan({ effects: [], system: {} }, staff).create).toHaveLength(1);
    expect(dataFixPlan({ effects: [{ _id: "3qnJecDB1SMFTNLw" }], system: {} }, staff).create).toEqual([]);
  });
  it("Ring of X-ray Vision: the save that no longer designates anything receives Exhaustion", () => {
    const ring = ITEM_FIXES["ring-of-x-ray-vision"].dataFixes;
    const v3 = { effects: [], system: { activities: { v41FhJBMoCPTochw: { effects: [] } } } };
    const v2 = { effects: [], system: { activities: { v41FhJBMoCPTochw: { effects: [{ _id: "InZzuugyN8PbtKGR" }] } } } };
    expect(dataFixPlan(v3, ring).item).toEqual({ "system.activities.v41FhJBMoCPTochw.effects": [{ _id: "InZzuugyN8PbtKGR" }] });
    expect(dataFixPlan(v2, ring).item).toEqual({});
  });
  it("`unless` est un id d'effet", () => {
    expect(validateDataFixes(fix)).toEqual([]);
    expect(validateDataFixes([{ effect: "dasRobeOfStars00", create: {}, unless: "short" }])).toHaveLength(1);
  });
});
