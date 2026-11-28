/**
 * Hunter's Defense (Ranger, Hunter 15 — SRD 5.2): a Reaction when the Ranger takes damage gives them
 * Resistance to that damage and to all other damage of the same type until the end of the current turn. `resist` step of a
 * Reaction.
 */
import { describe, it, expect } from "vitest";
import { turnResistanceChanges } from "../module/scripts/core/turn-resistance.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("turnResistanceChanges", () => {
  it("one change per type of the hit, in the dnd5e form", () => {
    expect(turnResistanceChanges(["slashing", "fire"])).toEqual([
      { key: "system.traits.dr.value", type: "add", value: "slashing", phase: "initial" },
      { key: "system.traits.dr.value", type: "add", value: "fire", phase: "initial" }]);
  });
  it("nothing for a type already resisted or that the bearer is immune to, nor twice", () => {
    expect(turnResistanceChanges(["fire", "fire", "cold"], { resisted: new Set(["fire"]), immune: ["cold"] })).toEqual([]);
    expect(turnResistanceChanges(["fire", "cold"], { resisted: ["fire"] }).map(c => c.value)).toEqual(["cold"]);
    expect(turnResistanceChanges([])).toEqual([]);
    expect(turnResistanceChanges(undefined)).toEqual([]);
  });
});

describe("the `resist` step and the entry", () => {
  it("asks for a Reaction on a hit, like `halve`", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "resist" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "resist" }] }] }))
      .toEqual(["triggers[0].do: \"resist\" requires the isHit or allyIsHit moment and a \"use\" reaction"]);
  });
  it("Hunter's Defense", () => {
    expect(CONTENT["superior-hunters-defense"]).toEqual({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "resist" }] }] });
    expect(validateEntry(CONTENT["superior-hunters-defense"])).toEqual([]);
  });
});

describe("placesOwnResistance — the activity's effects are not placed when the step places the Resistance", () => {
  it("the entry's Reaction activity, or the one the `use` step names", async () => {
    const { placesOwnResistance } = await import("../module/scripts/core/turn-resistance.mjs");
    expect(placesOwnResistance(CONTENT["superior-hunters-defense"], "KAgnJeRtqjDeYJ2S")).toBe(true);
    const named = { triggers: [{ on: "isHit", do: [{ type: "use", activity: "aaaaaaaaaaaaaaaa" }, { type: "resist" }] }] };
    expect(placesOwnResistance(named, "aaaaaaaaaaaaaaaa")).toBe(true);
    expect(placesOwnResistance(named, "bbbbbbbbbbbbbbbb")).toBe(false);
  });
  it("a Reaction without `resist` (Uncanny Dodge), or no entry: no", async () => {
    const { placesOwnResistance } = await import("../module/scripts/core/turn-resistance.mjs");
    expect(placesOwnResistance({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "halve" }] }] }, "aaaaaaaaaaaaaaaa")).toBe(false);
    expect(placesOwnResistance(null, "aaaaaaaaaaaaaaaa")).toBe(false);
  });
});
