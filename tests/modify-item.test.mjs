import { describe, expect, it } from "vitest";
import { comesFromChange, missingModifications, modifyOrigin } from "../module/scripts/core/modify-item.mjs";

const feature = (over={}) => ({ id: "feat0000000000aa", name: "Strikes", advancements: [{ id: "adv0000000000aaa",
  changes: [{ _id: "ench000000000aaa", uuid: null, identifiers: ["weapon:unarmed-strike"], effectName: "Strikes" }], modified: [] }], ...over });
const fist = { id: "fist000000000aaa", name: "Unarmed Strike" };
const run = (features, targets, effects) => missingModifications(features, key => targets[key] ?? [], id => effects[id] ?? []);

describe("enchantments of the ModifyItem progression (modify-item check)", () => {
  it("flags the targeted item with no enchantment", () => {
    const out = run([feature()], { "weapon:unarmed-strike": [fist] }, {});
    expect(out).toHaveLength(1);
    expect(out[0].target.id).toBe(fist.id);
    expect(out[0].change._id).toBe("ench000000000aaa");
  });

  it("flags nothing when dnd5e placed the enchantment (progression mark)", () => {
    const effect = { id: "e1", name: "Renamed", type: "enchantment", advancementOrigin: modifyOrigin("feat0000000000aa", "adv0000000000aaa"),
      sourceId: "Actor.a.Item.feat0000000000aa.ActiveEffect.ench000000000aaa" };
    expect(run([feature()], { "weapon:unarmed-strike": [fist] }, { [fist.id]: [effect] })).toEqual([]);
  });

  it("flags nothing when the progression records the enchantment and it is still there", () => {
    const f = feature();
    f.advancements[0].modified = [{ change: "ench000000000aaa", item: fist.id, effect: "e1" }];
    expect(run([f], { "weapon:unarmed-strike": [fist] }, { [fist.id]: [{ id: "e1" }] })).toEqual([]);
    // Recorded but gone: to be placed again.
    expect(run([f], { "weapon:unarmed-strike": [fist] }, { [fist.id]: [] })).toHaveLength(1);
  });

  it("does not double an enchantment of the same name placed otherwise", () => {
    const old = { id: "e9", name: "Strikes", type: "enchantment" };
    expect(run([feature()], { "weapon:unarmed-strike": [fist] }, { [fist.id]: [old] })).toEqual([]);
  });

  it("an effect from another change of the same progression does not count", () => {
    const other = { id: "e2", name: "Other", type: "enchantment", advancementOrigin: modifyOrigin("feat0000000000aa", "adv0000000000aaa"),
      sourceId: "Actor.a.Item.feat0000000000aa.ActiveEffect.zzzz000000000zzz" };
    expect(run([feature()], { "weapon:unarmed-strike": [fist] }, { [fist.id]: [other] })).toHaveLength(1);
  });

  it("ignores the missing item, an item added by a rider, and an unfindable feature effect", () => {
    expect(run([feature()], {}, {})).toEqual([]);
    expect(run([feature()], { "weapon:unarmed-strike": [{ ...fist, dependent: true }] }, {})).toEqual([]);
    const f = feature();
    f.advancements[0].changes[0].exists = false;
    expect(run([f], { "weapon:unarmed-strike": [fist] }, {})).toEqual([]);
  });

  it("an item targeted by two identifiers is counted only once", () => {
    const f = feature();
    f.advancements[0].changes[0].identifiers = ["weapon:unarmed-strike", "unarmed-strike"];
    expect(run([f], { "weapon:unarmed-strike": [fist], "unarmed-strike": [fist] }, {})).toHaveLength(1);
  });

  it("a change's remote uuid is enough to recognize the effect", () => {
    const f = feature();
    f.advancements[0].changes[0].uuid = "Compendium.dnd5e.effects.ActiveEffect.remote0000000aaa";
    const e = { id: "e3", advancementOrigin: modifyOrigin(f.id, f.advancements[0].id), sourceId: "Compendium.dnd5e.effects.ActiveEffect.remote0000000aaa" };
    expect(comesFromChange(e, { origin: modifyOrigin(f.id, f.advancements[0].id), change: f.advancements[0].changes[0] })).toBe(true);
  });
});
