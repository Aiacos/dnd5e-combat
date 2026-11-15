import { describe, expect, it } from "vitest";
import { originKey, spellDuplicates } from "../module/scripts/core/spell-duplicates.mjs";

const PREF = ["Compendium.book.spells.", "Compendium.srd.spells."];
const spell = (id, over={}) => ({ id, name: "Bolt", identifier: "bolt", method: "spell", prepared: 0, sourceItem: "class:cleric",
  source: "Compendium.srd.spells.Item.bolt", flagScopes: [], sort: 0, ...over });

describe("sorts en double (vérification spell-duplicates)", () => {
  it("garde la copie du compendium préféré et lui donne la préparation la plus haute", () => {
    const [g] = spellDuplicates([
      spell("a", { prepared: 1 }),
      spell("b", { source: "Compendium.book.spells.Item.bolt" })
    ], { preferred: PREF });
    expect(g.keep.id).toBe("b");
    expect(g.remove.map(r => r.id)).toEqual(["a"]);
    expect(g.prepared).toBe(1);
    expect(g.raisePrepared).toBe(true);
  });

  it("à compendium égal, garde la plus préparée", () => {
    const [g] = spellDuplicates([spell("a"), spell("b", { prepared: 2 })], { preferred: PREF });
    expect(g.keep.id).toBe("b");
    expect(g.raisePrepared).toBe(false);
  });

  it("ne regroupe pas deux origines, deux méthodes ni deux sorts différents", () => {
    expect(spellDuplicates([spell("a"), spell("b", { sourceItem: "subclass:life" })])).toEqual([]);
    expect(spellDuplicates([spell("a"), spell("b", { method: "pact" })])).toEqual([]);
    expect(spellDuplicates([spell("a"), spell("b", { identifier: "bane" })])).toEqual([]);
  });

  it("ignore inné, à volonté, rituel seulement, et la copie qu'un objet lance", () => {
    for ( const method of ["innate", "atwill", "ritual"] ) expect(spellDuplicates([spell("a"), spell("b", { method })])).toEqual([]);
    expect(spellDuplicates([spell("a"), spell("b", { cachedFor: ".Item.x.Activity.y" })])).toEqual([]);
  });

  it("une origine vide vaut la seule classe de lanceur de la fiche", () => {
    expect(originKey({ sourceItem: "" }, ["wizard"])).toBe("class:wizard");
    expect(originKey({ sourceItem: "" }, ["wizard", "cleric"])).toBe("");
    expect(originKey({ classIdentifier: "druid", sourceItem: "" })).toBe("class:druid");
    const groups = spellDuplicates([spell("a", { sourceItem: "" }), spell("b", { sourceItem: "class:cleric" })], { casterClasses: ["cleric"] });
    expect(groups).toHaveLength(1);
  });

  it("recopie les portées de flags que seul un sort retiré porte, sauf celles du système", () => {
    const [g] = spellDuplicates([
      spell("keep", { source: "Compendium.book.spells.Item.bolt", flagScopes: ["anim"] }),
      spell("old", { flagScopes: ["anim", "my-module", "dnd5e", "core"] })
    ], { preferred: PREF });
    expect(g.keep.id).toBe("keep");
    expect(g.flagScopes).toEqual([{ scope: "my-module", from: "old" }]);
  });

  it("trois copies : une gardée, deux retirées", () => {
    const [g] = spellDuplicates([spell("a"), spell("b"), spell("c", { source: "Compendium.book.spells.Item.bolt" })], { preferred: PREF });
    expect(g.keep.id).toBe("c");
    expect(g.remove.map(r => r.id).sort()).toEqual(["a", "b"]);
  });
});
