import { describe, it, expect } from "vitest";
import { INLINE_HOOKS, inlineRequestOf, windowValuesOf } from "../module/scripts/core/inline-check.mjs";

const link = type => ({ type });

describe("§536: inline journal checks become the engine's requested roll", () => {
  it("maps each pre-roll hook to a request type", () => {
    expect(INLINE_HOOKS["dnd5e.preRollSkillV2"]).toBe("skill");
    expect(INLINE_HOOKS["dnd5e.preRollSavingThrowV2"]).toBe("save");
  });
  it("[[/check wis prc 11]]: Perception, Wisdom, DC 11, taken as they are", () => {
    const request = inlineRequestOf("skill", { skill: "prc", ability: "wis", target: 11, hookNames: ["skill", "abilityCheck", "d20Test", ""] },
      link("skill"));
    expect(request).toMatchObject({ type: "skill", key: "prc", ability: "wis", dc: 11, hideDc: false });
  });
  it("a skill link without DC has no DC", () => {
    expect(inlineRequestOf("skill", { skill: "ste", hookNames: ["skill"] }, link("check")).dc).toBeNull();
  });
  it("ability check, saving throw and tool", () => {
    expect(inlineRequestOf("check", { ability: "str", target: 15, hookNames: ["abilityCheck", "d20Test"] }, link("check")))
      .toMatchObject({ type: "check", key: "str", dc: 15, ability: null });
    expect(inlineRequestOf("save", { ability: "dex", target: 14, hookNames: ["savingThrow", "d20Test"] }, link("save")))
      .toMatchObject({ type: "save", key: "dex", dc: 14 });
    expect(inlineRequestOf("tool", { tool: "thief", ability: "dex", hookNames: ["tool", "abilityCheck"] }, link("tool")))
      .toMatchObject({ type: "tool", key: "thief", ability: "dex" });
  });
  it("the ability-check hook of a skill roll is not taken twice", () => {
    expect(inlineRequestOf("check", { ability: "wis", skill: "prc", hookNames: ["skill", "abilityCheck"] }, link("skill"))).toBeNull();
  });
  it("leaves to dnd5e: no link, other link types, concentration, initiative", () => {
    expect(inlineRequestOf("skill", { skill: "prc" }, null)).toBeNull();
    expect(inlineRequestOf("save", { ability: "con" }, link("attack"))).toBeNull();
    expect(inlineRequestOf("save", { ability: "con", hookNames: ["concentration", "savingThrow"] }, link("concentration"))).toBeNull();
    expect(inlineRequestOf("save", { ability: "con", hookNames: ["concentration", "savingThrow"] }, link("save"))).toBeNull();
    expect(inlineRequestOf("check", { ability: "dex", hookNames: ["initiativeDialog", "abilityCheck"] }, link("check"))).toBeNull();
    expect(inlineRequestOf("skill", { hookNames: ["skill"] }, link("skill"))).toBeNull();
  });
  it("keeps the link's advantage or disadvantage", () => {
    expect(inlineRequestOf("skill", { skill: "ath", advantage: true, hookNames: ["skill"] }, link("skill")).advantage).toBe(true);
  });
  it("fills the GM's request window", () => {
    const request = inlineRequestOf("skill", { skill: "prc", ability: "wis", target: 11, disadvantage: true, hookNames: ["skill"] }, link("skill"));
    expect(windowValuesOf(request)).toEqual({ type: "skill", key: "prc", ability: "wis", dc: 11, mode: "disadvantage" });
    expect(windowValuesOf(inlineRequestOf("save", { ability: "dex", hookNames: ["savingThrow"] }, link("save"))).dc).toBe("");
  });
});
