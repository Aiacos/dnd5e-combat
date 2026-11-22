import { describe, it, expect } from "vitest";
import { sourceKeys } from "../module/scripts/core/source-keys.mjs";
import { SOURCES } from "../module/scripts/content/index.mjs";

const FEATURES = "Compendium.tiers.features.Item.tiersMorsure0001";

describe("§334 : les clés de source d'un item, de la plus précise à la plus large", () => {
  it("la source passe par l'acteur : « acteur.item » d'abord, comme avant", () => {
    const itemSource = "Compendium.tiers.actors.Actor.tiersActeur00001.Item.tiersMorsure0001";
    expect(sourceKeys({ itemSource, itemId: "abcdefghijklmnop" }))
      .toEqual(["tiersActeur00001.tiersMorsure0001", "tiersMorsure0001", "abcdefghijklmnop"]);
  });

  it("la source désigne le compendium des capacités : l'acteur se lit dans celui qui porte l'item", () => {
    // La copie d'une fiche dans le monde (ou un token) : l'acteur garde l'id de sa fiche dans sa propre source.
    expect(sourceKeys({ itemSource: FEATURES, itemId: "abcdefghijklmnop",
      actorSource: "Compendium.tiers.actors.Actor.tiersActeur00001", actorId: "mondeActeur00001" }))
      .toEqual(["features.tiersMorsure0001", "tiersActeur00001.tiersMorsure0001", "mondeActeur00001.tiersMorsure0001",
        "tiersMorsure0001", "abcdefghijklmnop"]);
    // La fiche elle-même, dans son compendium : pas de source, son id est celui de la fiche.
    expect(sourceKeys({ itemSource: FEATURES, itemId: "tiersMorsure0001", actorId: "tiersActeur00001" }))
      .toEqual(["features.tiersMorsure0001", "tiersActeur00001.tiersMorsure0001", "tiersMorsure0001"]);
  });

  it("sans source ni acteur : l'id de l'item seul ; rien du tout : aucune clé", () => {
    expect(sourceKeys({ itemId: "abcdefghijklmnop" })).toEqual(["abcdefghijklmnop"]);
    expect(sourceKeys({ itemSource: "Compendium.tiers.items.Item.tiersObjet000001" }))
      .toEqual(["items.tiersObjet000001", "tiersObjet000001"]);
    expect(sourceKeys()).toEqual([]);
  });

  it("les clés « acteur.item » livrées se trouvent pour un item dont la source désigne le compendium des capacités", () => {
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
