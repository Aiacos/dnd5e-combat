/**
 * The spells and items that the 2024 SRD renames keep the book's document id, not its identifier: the entry written under one of
 * the two identifiers must hold for the other. Seen: the Secret Chest (entry under `secret-chest`) received nothing when the item
 * came from the Player's Handbook (`leomunds-secret-chest`).
 */
import { describe, it, expect } from "vitest";
import { SHIPPED, SRD_ALIASES } from "../module/scripts/content/index.mjs";

describe("SRD and book identifiers: one entry, both names", () => {
  it("the Handbook's Secret Chest receives the entry written under the SRD identifier", () => {
    expect(SHIPPED["secret-chest"]?.summon?.initiative).toBe("none");
    expect(SHIPPED["leomunds-secret-chest"]).toBe(SHIPPED["secret-chest"]);
  });
  it("no pair in the table has the entry on one side only", () => {
    const oneSided = Object.entries(SRD_ALIASES).filter(([srd, book]) => !!SHIPPED[srd] !== !!SHIPPED[book]);
    expect(oneSided).toEqual([]);
  });
  it("the entry written under the book's identifier always holds for the SRD's", () => {
    expect(SHIPPED["black-tentacles"]).toBe(SHIPPED["evards-black-tentacles"]);
  });
});
