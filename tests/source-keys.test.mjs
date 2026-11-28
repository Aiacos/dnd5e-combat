import { describe, it, expect } from "vitest";
import { sourceKeys } from "../module/scripts/core/source-keys.mjs";
import { SOURCES } from "../module/scripts/content/index.mjs";

const FEATURES = "Compendium.tiers.features.Item.tiersMorsure0001";

describe("§334: an item's source keys, from the most precise to the broadest", () => {
  it("the source goes through the actor: \"actor.item\" first, as before", () => {
    const itemSource = "Compendium.tiers.actors.Actor.tiersActeur00001.Item.tiersMorsure0001";
    expect(sourceKeys({ itemSource, itemId: "abcdefghijklmnop" }))
      .toEqual(["tiersActeur00001.tiersMorsure0001", "tiersMorsure0001", "abcdefghijklmnop"]);
  });

  it("the source designates the features compendium: the actor is read from the one that carries the item", () => {
    // The copy of a sheet in the world (or a token): the actor keeps its sheet's id in its own source.
    expect(sourceKeys({ itemSource: FEATURES, itemId: "abcdefghijklmnop",
      actorSource: "Compendium.tiers.actors.Actor.tiersActeur00001", actorId: "mondeActeur00001" }))
      .toEqual(["features.tiersMorsure0001", "tiersActeur00001.tiersMorsure0001", "mondeActeur00001.tiersMorsure0001",
        "tiersMorsure0001", "abcdefghijklmnop"]);
    // The sheet itself, in its compendium: no source, its id is the sheet's.
    expect(sourceKeys({ itemSource: FEATURES, itemId: "tiersMorsure0001", actorId: "tiersActeur00001" }))
      .toEqual(["features.tiersMorsure0001", "tiersActeur00001.tiersMorsure0001", "tiersMorsure0001"]);
  });

  it("without source or actor: the item's id alone; nothing at all: no key", () => {
    expect(sourceKeys({ itemId: "abcdefghijklmnop" })).toEqual(["abcdefghijklmnop"]);
    expect(sourceKeys({ itemSource: "Compendium.tiers.items.Item.tiersObjet000001" }))
      .toEqual(["items.tiersObjet000001", "tiersObjet000001"]);
    expect(sourceKeys()).toEqual([]);
  });

  it("the shipped \"actor.item\" keys are found for an item whose source designates the features compendium", () => {
    const scoped = Object.keys(SOURCES).filter(k => k.includes("."));
    expect(scoped.length).toBeGreaterThan(0);
    for ( const key of scoped ) {
      const [actor, item] = key.split(".");
      const keys = sourceKeys({ itemSource: `Compendium.tiers.features.Item.${item}`, itemId: "abcdefghijklmnop",
        actorSource: `Compendium.tiers.actors.Actor.${actor}`, actorId: "mondeActeur00001" });
      expect(keys.find(k => k in SOURCES), key).toBe(key);
    }
  });
});
