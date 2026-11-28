import { describe, expect, it } from "vitest";
import { originKey, spellDuplicates } from "../module/scripts/core/spell-duplicates.mjs";

const PREF = ["Compendium.book.spells.", "Compendium.srd.spells."];
const spell = (id, over={}) => ({ id, name: "Bolt", identifier: "bolt", method: "spell", prepared: 0, sourceItem: "class:cleric",
  source: "Compendium.srd.spells.Item.bolt", flagScopes: [], sort: 0, ...over });

describe("duplicate spells (spell-duplicates check)", () => {
  it("keeps the preferred compendium's copy and gives it the highest preparation", () => {
    const [g] = spellDuplicates([
      spell("a", { prepared: 1 }),
      spell("b", { source: "Compendium.book.spells.Item.bolt" })
    ], { preferred: PREF });
    expect(g.keep.id).toBe("b");
    expect(g.remove.map(r => r.id)).toEqual(["a"]);
    expect(g.prepared).toBe(1);
    expect(g.raisePrepared).toBe(true);
  });

  it("with equal compendium, keeps the most prepared", () => {
    const [g] = spellDuplicates([spell("a"), spell("b", { prepared: 2 })], { preferred: PREF });
    expect(g.keep.id).toBe("b");
    expect(g.raisePrepared).toBe(false);
  });

  it("does not group two origins, two methods or two different spells", () => {
    expect(spellDuplicates([spell("a"), spell("b", { sourceItem: "subclass:life" })])).toEqual([]);
    expect(spellDuplicates([spell("a"), spell("b", { method: "pact" })])).toEqual([]);
    expect(spellDuplicates([spell("a"), spell("b", { identifier: "bane" })])).toEqual([]);
  });

  it("ignores innate, at will, ritual only, and the copy that an item casts", () => {
    for ( const method of ["innate", "atwill", "ritual"] ) expect(spellDuplicates([spell("a"), spell("b", { method })])).toEqual([]);
    expect(spellDuplicates([spell("a"), spell("b", { cachedFor: ".Item.x.Activity.y" })])).toEqual([]);
  });

  it("an empty origin means the sheet's single caster class", () => {
    expect(originKey({ sourceItem: "" }, ["wizard"])).toBe("class:wizard");
    expect(originKey({ sourceItem: "" }, ["wizard", "cleric"])).toBe("");
    expect(originKey({ classIdentifier: "druid", sourceItem: "" })).toBe("class:druid");
    const groups = spellDuplicates([spell("a", { sourceItem: "" }), spell("b", { sourceItem: "class:cleric" })], { casterClasses: ["cleric"] });
    expect(groups).toHaveLength(1);
  });

  it("copies the flag scopes that only a removed spell carries, except those of the system", () => {
    const [g] = spellDuplicates([
      spell("keep", { source: "Compendium.book.spells.Item.bolt", flagScopes: ["anim"] }),
      spell("old", { flagScopes: ["anim", "my-module", "dnd5e", "core"] })
    ], { preferred: PREF });
    expect(g.keep.id).toBe("keep");
    expect(g.flagScopes).toEqual([{ scope: "my-module", from: "old" }]);
  });

  it("three copies: one kept, two removed", () => {
    const [g] = spellDuplicates([spell("a"), spell("b"), spell("c", { source: "Compendium.book.spells.Item.bolt" })], { preferred: PREF });
    expect(g.keep.id).toBe("c");
    expect(g.remove.map(r => r.id).sort()).toEqual(["a", "b"]);
  });
});
