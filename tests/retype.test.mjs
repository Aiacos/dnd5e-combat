import { describe, it, expect } from "vitest";
import { retypeOffers } from "../module/scripts/core/retype.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const SIX = ["acid", "cold", "fire", "lightning", "poison", "thunder"];
const transmuted = { types: SIX, from: SIX, cost: "FT1V43gRA47fCA51", payable: true };

describe("damage types offered to a spell (spellDamageTypes)", () => {
  it("Transmuted Spell: a fire spell can take the five other types, by paying; not its own", () => {
    const offers = retypeOffers([transmuted], ["fire"]);
    expect(offers.map(o => o.type)).toEqual(["acid", "cold", "lightning", "poison", "thunder"]);
    expect(offers.every(o => o.cost === "FT1V43gRA47fCA51")).toBe(true);
  });
  it("a spell that deals no type from the list is not concerned (necrotic, radiant, force)", () => {
    expect(retypeOffers([transmuted], ["necrotic"])).toEqual([]);
    expect(retypeOffers([transmuted], ["force"])).toEqual([]);
  });
  it("plus de quoi payer : rien n'est offert", () => {
    expect(retypeOffers([{ ...transmuted, payable: false }], ["fire"])).toEqual([]);
  });
  it("Sorts psychiques : gratuit, pour tout type de sort", () => {
    expect(retypeOffers([{ types: ["psychic"] }], ["fire"])).toEqual([{ type: "psychic", cost: null }]);
    expect(retypeOffers([{ types: ["psychic"] }], ["psychic"])).toEqual([]);
  });
  it("the same type offered twice: the free rule wins", () => {
    const both = retypeOffers([{ types: ["cold"], cost: "aaaaaaaaaaaaaaaa", payable: true }, { types: ["cold"] }], ["fire"]);
    expect(both).toEqual([{ type: "cold", cost: null }]);
  });
  it("content and schema", () => {
    expect(CONTENT["transmuted-spell"].spellDamageTypes).toEqual({ types: SIX, from: SIX, cost: "FT1V43gRA47fCA51" });
    expect(validateEntry(CONTENT["transmuted-spell"])).toEqual([]);
    expect(validateEntry({ spellDamageTypes: { types: ["cold"], from: [] } })).toHaveLength(1);
    expect(validateEntry({ spellDamageTypes: { types: ["cold"], cost: "court" } })).toHaveLength(1);
  });
});
