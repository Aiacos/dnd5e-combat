/**
 * Quivering Palm (Monk, Open Hand 17 — SRD 5.2): 4 Focus Points on an unarmed strike set up vibrations; only one creature at a
 * time; ending them imposes a Constitution save (10d12 force, half on a success).
 */
import { describe, it, expect } from "vitest";
import { supersededEffects, endsHeldEffect, riderAffordable } from "../module/scripts/core/held-effect.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("supersededEffects — one creature at a time", () => {
  const rule = { effect: "GnIJc9uI54mfAQz8", single: true };
  it("the vibrations placed elsewhere fall; those of the same creature stay with whoever places the effect", () => {
    const placed = { id: "new", bearer: "B" };
    const others = [{ id: "old", bearer: "A" }, placed, { id: "same", bearer: "B" }];
    expect(supersededEffects(rule, placed, others)).toEqual([{ id: "old", bearer: "A" }]);
  });
  it("sans `single`, rien", () => {
    expect(supersededEffects({ effect: "GnIJc9uI54mfAQz8" }, { id: "new", bearer: "B" }, [{ id: "old", bearer: "A" }])).toEqual([]);
  });
});

describe("endsHeldEffect", () => {
  it("only the declared activity", () => {
    const rule = { effect: "GnIJc9uI54mfAQz8", endedBy: "lBn87Q4yyJXWzLqg" };
    expect(endsHeldEffect(rule, "lBn87Q4yyJXWzLqg")).toBe(true);
    expect(endsHeldEffect(rule, "O1mQr2rPpzRpB3yJ")).toBe(false);
    expect(endsHeldEffect(null, "lBn87Q4yyJXWzLqg")).toBe(false);
  });
});

describe("riderAffordable — a boon that costs several uses", () => {
  it("`cost` uses are needed; one by default", () => {
    expect(riderAffordable(4, 4)).toBe(true);
    expect(riderAffordable(3, 4)).toBe(false);
    expect(riderAffordable(1)).toBe(true);
    expect(riderAffordable(0)).toBe(false);
    expect(riderAffordable(Infinity, 4)).toBe(true);
  });
});

describe("the entry and the schema", () => {
  it("Paume vibratoire", () => {
    const entry = CONTENT["quivering-palm"];
    expect(entry.hitRider).toEqual({ effect: "GnIJc9uI54mfAQz8", unarmed: true, pays: "monks-focus", cost: 4 });
    expect(entry.heldEffect).toEqual({ effect: "GnIJc9uI54mfAQz8", single: true, endedBy: "lBn87Q4yyJXWzLqg" });
    expect(validateEntry(entry)).toEqual([]);
  });
  it("rejected forms", () => {
    expect(validateEntry({ hitRider: { effect: "GnIJc9uI54mfAQz8", cost: 4 } }).length).toBe(1);
    expect(validateEntry({ heldEffect: { effect: "GnIJc9uI54mfAQz8" } }).length).toBe(1);
  });
});
