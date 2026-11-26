import { describe, it, expect } from "vitest";
import { favoriteIdOf, favoritePlan, favoriteRemoval } from "../module/scripts/core/spell-weapons.mjs";

describe("§554: spell weapons in the sheet's favorites", () => {
  const id = favoriteIdOf("itemAAAAAAAAAAAA", "dnd5eactivity000");

  it("writes the favorite id as dnd5e does for a dropped activity", () => {
    expect(id).toBe(".Item.itemAAAAAAAAAAAA.Activity.dnd5eactivity000");
  });

  it("adds and marks the attack when it is not a favorite yet", () => {
    expect(favoritePlan({ supported: true, favorites: [], id })).toEqual({ add: true, mark: true });
  });

  it("leaves a favorite the player put there alone (no mark)", () => {
    expect(favoritePlan({ supported: true, favorites: [id], id })).toEqual({ add: false, mark: false });
  });

  it("an actor without favorites (an NPC) gets nothing", () => {
    expect(favoritePlan({ supported: false, favorites: [], id })).toEqual({ add: false, mark: false });
  });

  it("cast again: the new trace keeps the mark of the one it replaces", () => {
    expect(favoritePlan({ supported: true, favorites: [id], id, inherited: true })).toEqual({ add: false, mark: true });
    expect(favoritePlan({ supported: true, favorites: [], id, inherited: true })).toEqual({ add: true, mark: true });
  });

  it("removes only the favorite DAS added, and not while the spell is cast again", () => {
    expect(favoriteRemoval({ marked: id, favorites: [id, ".Item.other.Activity.x"] })).toBe(true);
    expect(favoriteRemoval({ marked: null, favorites: [id] })).toBe(false);
    expect(favoriteRemoval({ marked: id, favorites: [id], replaced: true })).toBe(false);
    expect(favoriteRemoval({ marked: id, favorites: [] })).toBe(false);
  });
});
