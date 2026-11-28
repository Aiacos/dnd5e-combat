import { describe, it, expect } from "vitest";
import { typeAllowed, blockedStatuses, immuneToAll, CREATURE_TYPES } from "../module/scripts/core/eligibility.mjs";

describe("creature type (§16.8)", () => {
  it("\"a Humanoid\": yes for a humanoid, no for an Undead", () => {
    expect(typeAllowed(["humanoid"], "humanoid")).toBe(true);
    expect(typeAllowed(["humanoid"], "undead")).toBe(false);
  });
  it("without restriction, or without a known type: allowed (never a refusal out of ignorance)", () => {
    expect(typeAllowed(null, "undead")).toBe(true);
    expect(typeAllowed([], "undead")).toBe(true);
    expect(typeAllowed(["beast"], null)).toBe(true);
  });
  it("knows the fourteen dnd5e types", () => {
    expect(CREATURE_TYPES).toHaveLength(14);
    expect(CREATURE_TYPES).toContain("humanoid");
  });
});

describe("condition immunities (§16.8)", () => {
  it("the blocked conditions of an effect", () => {
    expect(blockedStatuses(["charmed", "incapacitated"], ["charmed", "poisoned"])).toEqual(["charmed"]);
    expect(blockedStatuses(["paralyzed"], [])).toEqual([]);
  });
  it("an action that only places blocked effects does not affect the creature", () => {
    expect(immuneToAll({ effects: [["charmed", "incapacitated"]] }, ["charmed"])).toBe("charmed");
    expect(immuneToAll({ effects: [["paralyzed"], ["charmed"]] }, ["charmed"])).toBeNull();   // un effet passe
  });
  it("damage, healing or an outcome step still affect it; without an effect, nothing to judge", () => {
    expect(immuneToAll({ damage: true, effects: [["poisoned"]] }, ["poisoned"])).toBeNull();
    expect(immuneToAll({ steps: true, effects: [["poisoned"]] }, ["poisoned"])).toBeNull();
    expect(immuneToAll({ effects: [] }, ["poisoned"])).toBeNull();
    expect(immuneToAll({ effects: [[]] }, ["poisoned"])).toBeNull();   // an effect without a condition is never blocked
  });
});
