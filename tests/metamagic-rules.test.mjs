/**
 * Metamagic (SRD 5.2): one option per spell; two under Sorcery Incarnate (Sorcerer 7) as long as Innate Sorcery is active;
 * one option at no cost each turn under Arcane Apotheosis (Sorcerer 20), likewise.
 */
import { describe, it, expect } from "vitest";
import { metamagicLimit, mayHold, freeOption } from "../module/scripts/core/metamagic-rules.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("metamagicLimit — combien d'options un sort peut porter", () => {
  it("one, without the rule or when Innate Sorcery is not active", () => {
    expect(metamagicLimit([])).toBe(1);
    expect(metamagicLimit([{ limit: 2, active: false }])).toBe(1);
    expect(metamagicLimit([{ freePerTurn: true, active: true }])).toBe(1);
  });
  it("two under active Sorcery Incarnate", () => {
    expect(metamagicLimit([{ limit: 2, active: true }, { freePerTurn: true, active: true }])).toBe(2);
  });
});

describe("mayHold — retenir une option de plus", () => {
  it("the first always; the second only if the limit allows it; the same one twice does not count", () => {
    expect(mayHold([], "quickened", 1)).toBe(true);
    expect(mayHold(["quickened"], "subtle", 1)).toBe(false);
    expect(mayHold(["quickened"], "subtle", 2)).toBe(true);
    expect(mayHold(["quickened", "subtle"], "careful", 2)).toBe(false);
    expect(mayHold(["quickened"], "quickened", 1)).toBe(true);
  });
});

describe("freeOption — sans points de sorcellerie", () => {
  const rules = [{ freePerTurn: true, active: true }];
  it("once each turn, as long as Innate Sorcery is active", () => {
    expect(freeOption(rules, { usedTurn: null, turn: "c.1.0" })).toBe(true);
    expect(freeOption(rules, { usedTurn: "c.1.0", turn: "c.1.0" })).toBe(false);
    expect(freeOption(rules, { usedTurn: "c.1.0", turn: "c.2.0" })).toBe(true);
    expect(freeOption([{ freePerTurn: true, active: false }], { usedTurn: null, turn: "c.1.0" })).toBe(false);
    expect(freeOption([{ limit: 2, active: true }], { usedTurn: null, turn: "c.1.0" })).toBe(false);
  });
  it("outside combat, no turn to count", () => {
    expect(freeOption(rules, { usedTurn: "c.1.0", turn: null })).toBe(true);
  });
});

describe("the entries and the schema", () => {
  it("Sorcery Incarnate, Arcane Apotheosis", () => {
    expect(CONTENT["sorcery-incarnate"]).toEqual({ metamagicRules: { whileEffect: "innate-sorcery", limit: 2 } });
    expect(CONTENT["arcane-apotheosis"]).toEqual({ metamagicRules: { whileEffect: "innate-sorcery", freePerTurn: true } });
    for ( const id of ["sorcery-incarnate", "arcane-apotheosis"] ) expect(validateEntry(CONTENT[id])).toEqual([]);
  });
  it("rejected forms", () => {
    expect(validateEntry({ metamagicRules: { whileEffect: "innate-sorcery" } }).length).toBe(1);
    expect(validateEntry({ metamagicRules: { limit: 2 } }).length).toBe(1);
    expect(validateEntry({ metamagicRules: { whileEffect: "innate-sorcery", limit: 1 } }).length).toBe(1);
  });
});
