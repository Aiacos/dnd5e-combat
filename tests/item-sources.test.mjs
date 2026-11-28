/** §276: provenance of an item for the diagnostic's repairs — another official module is never replaced by a namesake. */
import { describe, it, expect } from "vitest";
import { sourceKind } from "../module/scripts/core/item-sources.mjs";

describe("provenance d'un objet (diagnostic)", () => {
  it("Player's Handbook, Monster Manual, dnd5e: reference", () => {
    expect(sourceKind("Compendium.dnd-players-handbook.classes.Item.phbftrSurvivor00")).toBe("reference");
    expect(sourceKind("Compendium.dnd-monster-manual.actors.Actor.mmGoblinBoss0000.Item.x")).toBe("reference");
    expect(sourceKind("Compendium.dnd5e.spells24.Item.abc")).toBe("reference");
  });

  it("another official module (Ravenloft, Dungeon Master's Guide): premium, to keep", () => {
    expect(sourceKind("Compendium.dnd-ravenloft-horrors-within.options.Item.rhwSurvivor2zrM3")).toBe("premium");
    expect(sourceKind("Compendium.dnd-dungeon-masters-guide.equipment.Item.x")).toBe("premium");
  });

  it("third-party module, import or world: to take over; no source: nothing", () => {
    expect(sourceKind("Compendium.chris-premades.CPRSpells.Item.x")).toBe("other");
    expect(sourceKind("Compendium.world.ddb-dandd-ddb-monsters.Actor.a.Item.b")).toBe("other");
    expect(sourceKind("Compendium.dnd5e-combat.basics.Item.x")).toBe("other");
    expect(sourceKind("")).toBe("none");
    expect(sourceKind(undefined)).toBe("none");
  });
});
