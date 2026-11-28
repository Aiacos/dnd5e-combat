/**
 * Peerless Skill (Bard, College of Lore, level 14 — SRD 5.2): a failed ability check or attack roll, a Bardic Inspiration spent,
 * the die added to the d20; on a failure, the Inspiration is not spent.
 */
import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("Talent hors pair", () => {
  it("a die paid by the item's activity, on an attack or a check, refunded if the roll still fails", () => {
    const rule = CONTENT["peerless-skill"].rollBonus;
    expect(rule).toEqual({ activity: "dnd5eactivity000", on: ["attack", "check"], failRefund: true });
    expect(validateEntry(CONTENT["peerless-skill"])).toEqual([]);
  });
  it("not on a saving throw: the text names only the ability check and the attack roll", () => {
    expect(CONTENT["peerless-skill"].rollBonus.on).not.toContain("save");
  });
});

describe("formulaShown — the formula shown to the player", () => {
  it("a reference given by the data is replaced; the others stay", async () => {
    const { formulaShown } = await import("../module/scripts/core/formula-text.mjs");
    const die = { toString: () => "1d10" };
    expect(formulaShown("@scale.bard.inspiration", { scale: { bard: { inspiration: die } } })).toBe("1d10");
    expect(formulaShown("1d4 + @abilities.cha.mod", { abilities: { cha: { mod: 3 } } })).toBe("1d4 + 3");
    expect(formulaShown("@scale.bard.inspiration", {})).toBe("@scale.bard.inspiration");
    expect(formulaShown("@scale.bard", { scale: { bard: {} } })).toBe("@scale.bard");
    expect(formulaShown("1d10", null)).toBe("1d10");
  });
});
