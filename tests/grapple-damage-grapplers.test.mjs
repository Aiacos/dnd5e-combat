/**
 * §132: `grappleDamage` — `grapplers: true` extends the start-of-turn damage to creatures that grapple the author (Barbed Hide
 * of the Barbed Devil, SRD 5.2: "any creature it grapples or that grapples it").
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("grappleDamage: the creatures that grapple the author", () => {
  it("the schema accepts `grapplers: true` and nothing else", () => {
    const rule = { formula: "1d10", damageType: "piercing" };
    expect(validateEntry({ grappleDamage: rule })).toEqual([]);
    expect(validateEntry({ grappleDamage: { ...rule, grapplers: true } })).toEqual([]);
    expect(validateEntry({ grappleDamage: { ...rule, grapplers: false } })).toHaveLength(1);
    expect(validateEntry({ grappleDamage: { ...rule, grapplers: "all" } })).toHaveLength(1);
    expect(validateEntry({ grappleDamage: { ...rule, to: "both" } })).toHaveLength(1);
  });
  it("Barbed Hide is shipped; Unarmed Strike does not change", () => {
    expect(CONTENT["barbed-hide"].grappleDamage).toEqual({ formula: "1d10", damageType: "piercing", grapplers: true });
    expect(validateEntry(CONTENT["barbed-hide"], { at: "barbed-hide." })).toEqual([]);
    expect(CONTENT["unarmed-fighting"].grappleDamage).toEqual({ formula: "1d4", damageType: "bludgeoning" });
  });
});
