import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { takenParts, returnedDamage } from "../module/scripts/core/damage-return.mjs";

const riposte = (step, extra={}) => ({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "source", ...step }], ...extra }] });

describe("§499 (B19): retaliation of the same amount — schema", () => {
  it("same: true or \"resisted\", optional imposed type, no formula", () => {
    expect(validateEntry(riposte({ same: true }))).toEqual([]);
    expect(validateEntry(riposte({ same: "resisted" }, { if: { "activity.isMelee": true } }), { facts: { "activity.isMelee": () => true } })).toEqual([]);
    expect(validateEntry(riposte({ same: true, damageType: "necrotic" }))).toEqual([]);
  });
  it("refusals: unknown value, formula or activity with same, other recipient", () => {
    expect(validateEntry(riposte({ same: "tout" }))).toEqual([expect.stringContaining(".same")]);
    expect(validateEntry(riposte({ same: true, formula: "1d6", damageType: "fire" }))).toEqual([expect.stringContaining("without formula")]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "origin", same: true }] }] }))
      .toEqual(expect.arrayContaining([expect.stringContaining("only for a riposte")]));
    expect(validateEntry(riposte({ same: true, damageType: "" }))).toEqual([expect.stringContaining("damageType")]);
  });
  it("at the isDamaged moment only, on a carried effect; a retaliation with a formula stays at the isHit moment", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "damage", to: "source", same: true }] }] }))
      .toEqual([expect.stringContaining("isDamaged as the only moment")]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", do: [{ type: "damage", to: "source", same: true }] }] }))
      .toEqual([expect.stringContaining("via: \"effect\"")]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "damage", to: "source", formula: "1d6", damageType: "fire" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "source", formula: "1d6", damageType: "fire" }] }] }))
      .toEqual([expect.stringContaining("requires isHit")]);
  });
});

describe("§499 (B19): shares taken and damage returned", () => {
  it("shares read from dnd5e's calculation: heals discarded, whole amounts, multiplier kept", () => {
    const calc = [{ type: "slashing", value: 4, active: { multiplier: 0.5 } }, { type: "fire", value: 3.7, active: {} },
      { type: "healing", value: -5, active: { multiplier: -1 } }, { type: "cold", value: 0, active: { multiplier: 0 } }];
    expect(takenParts(calc)).toEqual([{ type: "slashing", value: 4, multiplier: 0.5 }, { type: "fire", value: 3, multiplier: 1 }]);
    expect(takenParts(null)).toEqual([]);
  });
  it("same: true returns everything, by type; \"resisted\" only the reduced shares; damageType groups", () => {
    const parts = [{ type: "slashing", value: 4, multiplier: 0.5 }, { type: "slashing", value: 2, multiplier: 0.5 }, { type: "fire", value: 3, multiplier: 1 }];
    expect(returnedDamage(parts)).toEqual([{ type: "slashing", value: 6 }, { type: "fire", value: 3 }]);
    expect(returnedDamage(parts, { same: "resisted" })).toEqual([{ type: "slashing", value: 6 }]);
    expect(returnedDamage(parts, { damageType: "necrotic" })).toEqual([{ type: "necrotic", value: 9 }]);
    expect(returnedDamage([{ type: "fire", value: 3, multiplier: 1 }], { same: "resisted" })).toEqual([]);
    expect(returnedDamage([])).toEqual([]);
  });
});
