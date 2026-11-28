/** §65: Suggestion (damage from the caster or an ally), Holy Water (Fiends and Undead), shield of a worn item, basic action of choice. */
import { describe, it, expect } from "vitest";
import { damagedByOriginSide } from "../module/scripts/core/triggers.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("damagedByOriginSide: \"if you or your allies deal damage to it\"", () => {
  it("the caster itself", () => {
    expect(damagedByOriginSide({ damager: "Actor.a", origin: "Actor.a" })).toBe(true);
  });
  it("an ally: same disposition, friendly or hostile", () => {
    expect(damagedByOriginSide({ damager: "Actor.b", origin: "Actor.a", damagerDisposition: 1, originDisposition: 1 })).toBe(true);
    expect(damagedByOriginSide({ damager: "Actor.b", origin: "Actor.a", damagerDisposition: -1, originDisposition: -1 })).toBe(true);
  });
  it("un adversaire, un neutre, un auteur inconnu : non", () => {
    expect(damagedByOriginSide({ damager: "Actor.b", origin: "Actor.a", damagerDisposition: -1, originDisposition: 1 })).toBe(false);
    expect(damagedByOriginSide({ damager: "Actor.b", origin: "Actor.a", damagerDisposition: 0, originDisposition: 0 })).toBe(false);
    expect(damagedByOriginSide({ damager: null, origin: "Actor.a" })).toBe(false);
  });
});

describe("contenu des quatre points des PJ", () => {
  it("Suggestion: ends on damage from the caster or an ally", () => {
    expect(CONTENT.suggestion.triggers).toEqual([{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }]);
    expect(validateEntry(CONTENT.suggestion)).toEqual([]);
  });
  it("by: only with via effect and the isDamaged moment", () => {
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", by: "originSide", do: [{ type: "remove" }] }] }).length).toBeGreaterThan(0);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", by: "anyone", do: [{ type: "remove" }] }] }).length).toBeGreaterThan(0);
  });
  it("Holy Water (2024 and 2014): Fiends and Undead only", () => {
    expect(CONTENT["holy-water"].targets).toEqual({ types: ["fiend", "undead"] });
    expect(CONTENT["flask-of-holy-water"].targets).toEqual({ types: ["fiend", "undead"] });
  });
  it("shield of a worn item: worn (one damage type), not with effects", () => {
    expect(validateEntry({ damageShield: { worn: "cold", formula: "2d8" } })).toEqual([]);
    expect(validateEntry({ damageShield: { worn: "", formula: "2d8" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ damageShield: { worn: "cold", effects: { aaaaaaaaaaaaaaaa: "cold" }, formula: "2d8" } }).length).toBeGreaterThan(0);
  });
  it("basic action of choice: Nimble Escape, \"Immortal's Agility\"; \"Stealth in the Shadows\": Hide", () => {
    expect(CONTENT["nimble-escape"].basicActions).toEqual({ CcMi6Alf0pup7o81: { choose: ["disengage", "hide"] } });
    expect(CONTENT["deathless-agility"].basicActions).toEqual({ dlHNkpwbTgwm1UwG: { choose: ["dash", "disengage"] } });
    expect(CONTENT["shadow-stealth"].basicActions).toEqual({ ydslIM9mBqNRGOnq: "hide" });
    for ( const id of ["nimble-escape", "deathless-agility", "shadow-stealth"] ) expect(validateEntry(CONTENT[id])).toEqual([]);
  });
  it("choose : au moins deux actions connues, rien d'autre", () => {
    expect(validateEntry({ basicActions: { CcMi6Alf0pup7o81: { choose: ["hide"] } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ basicActions: { CcMi6Alf0pup7o81: { choose: ["hide", "fly"] } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ basicActions: { CcMi6Alf0pup7o81: { choose: ["hide", "dash"], extra: 1 } } }).length).toBeGreaterThan(0);
  });
});
