import { describe, it, expect } from "vitest";
import { usageLimitIssues, lowestSlotLevel, effectRefs, secondRageOption } from "../module/scripts/core/limits.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { resourceFeedback } from "../module/scripts/core/feedback.mjs";

const rule = { oncePerTurn: true, whenEmpty: "wild-shape" };
const base = { inCombat: true, ownTurn: true, usedThisTurn: false, remaining: 0 };

describe("Regain sauvage : limites d'utilisation", () => {
  it("on its turn, not yet used, empty Wild Shape: nothing is wrong", () => {
    expect(usageLimitIssues(rule, base)).toEqual([]);
  });
  it("outside its turn, or already used this turn", () => {
    expect(usageLimitIssues(rule, { ...base, ownTurn: false })).toEqual(["notOwnTurn"]);
    expect(usageLimitIssues(rule, { ...base, usedThisTurn: true })).toEqual(["oncePerTurn"]);
  });
  it("il reste des utilisations de Forme sauvage", () => {
    expect(usageLimitIssues(rule, { ...base, remaining: 2 })).toEqual(["notEmpty"]);
  });
  it("hors combat : ni tour ni limite par tour", () => {
    expect(usageLimitIssues(rule, { inCombat: false, ownTurn: false, usedThisTurn: true, remaining: 0 })).toEqual([]);
  });
  it("l'emplacement le plus bas disponible", () => {
    expect(lowestSlotLevel({ 1: 0, 2: 3, 3: 1 })).toBe(2);
    expect(lowestSlotLevel({ 1: 4 })).toBe(1);
    expect(lowestSlotLevel({ 1: 0, 2: 0 })).toBe(null);
  });
  it("resources returned: only for an activity that gives something back", () => {
    // Regain de Forme sauvage : +1 Forme sauvage, −1 emplacement niv. 2.
    expect(resourceFeedback([{ type: "itemUses", value: -1, name: "Forme sauvage" }, { type: "spellSlots", value: 1, level: 2 }]))
      .toEqual([{ kind: "gain", type: "itemUses", n: 1, name: "Forme sauvage" }, { kind: "spend", type: "spellSlots", n: 1, level: 2 }]);
    // Un sort ordinaire : rien.
    expect(resourceFeedback([{ type: "spellSlots", value: 1, level: 3 }])).toEqual([]);
  });
  it("schema", () => {
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { ...rule, lowestSlot: true, noDialog: true, cost: "bonus" } } })).toEqual([]);
    // §298: "free" is allowed (Sacred Weapon); any other word is not.
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { cost: "free" } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { cost: "gratis" } } })).toEqual(["usageLimits.7nAgPNN2dth7SR0D.cost: action, bonus, reaction, free"]);
    expect(validateEntry({ usageLimits: { court: { oncePerTurn: 1 } } }))
      .toEqual(["usageLimits.court: activity id (16 characters) expected", "usageLimits.court.oncePerTurn: true or absent"]);
  });
});

describe("automatic: activity already played by the engine (\"Thunder Hammer\", DMG 3.0.0)", () => {
  const off = { inCombat: false, ownTurn: false, usedThisTurn: false, remaining: null };
  it("refused (forceable) in combat as out of combat", () => {
    expect(usageLimitIssues({ automatic: true }, off)).toEqual(["automatic"]);
    expect(usageLimitIssues({ automatic: true }, { ...off, inCombat: true, ownTurn: true })).toEqual(["automatic"]);
  });
  it("validated: true or absent", () => {
    expect(validateEntry({ usageLimits: { xChnR5QIa3RWxr7K: { automatic: true } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { xChnR5QIa3RWxr7K: { automatic: 1 } } })).toEqual(["usageLimits.xChnR5QIa3RWxr7K.automatic: true or absent"]);
  });
});

describe("§486: activity allowed only under an effect (whileEffect / unlessEffect)", () => {
  const off = { inCombat: false, ownTurn: false, usedThisTurn: false, remaining: null };
  it("without the required effect: refused, in combat or not; with it: allowed", () => {
    expect(usageLimitIssues({ whileEffect: "alter-self" }, { ...off, underEffect: false })).toEqual(["needsEffect"]);
    expect(usageLimitIssues({ whileEffect: "alter-self" }, { ...base, underEffect: false })).toEqual(["needsEffect"]);
    expect(usageLimitIssues({ whileEffect: "alter-self" }, { ...off, underEffect: true })).toEqual([]);
  });
  it("under an effect that forbids it: refused; outside it: allowed", () => {
    expect(usageLimitIssues({ unlessEffect: ["aaaaaaaaaaaaaaaa"] }, { ...off, barredByEffect: true })).toEqual(["barredByEffect"]);
    expect(usageLimitIssues({ unlessEffect: ["aaaaaaaaaaaaaaaa"] }, { ...off, barredByEffect: false })).toEqual([]);
  });
  it("unknown condition (not computed): nothing", () => {
    expect(usageLimitIssues({ whileEffect: "alter-self", unlessEffect: "x" }, off)).toEqual([]);
  });
  it("references: single string or list", () => {
    expect(effectRefs("alter-self")).toEqual(["alter-self"]);
    expect(effectRefs(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"])).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    expect(effectRefs(undefined)).toEqual([]);
  });
  it("schema", () => {
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { whileEffect: "alter-self" } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { whileEffect: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"], oncePerTurn: true } } })).toEqual([]);
    expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { unlessEffect: "some-form" } } })).toEqual([]);
    for ( const bad of [[], "", 3, [""], [1]] ) {
      expect(validateEntry({ usageLimits: { "7nAgPNN2dth7SR0D": { whileEffect: bad } } }))
        .toEqual(["usageLimits.7nAgPNN2dth7SR0D.whileEffect: item identifier or effect id, or a non-empty list of them"]);
    }
  });
});

describe("§509 (Core#98): \"Predator's Rage\", one option per Rage", () => {
  it("in Rage, an option already taken refuses the next (forceable concern)", () => {
    expect(secondRageOption({ oneOption: true, raging: true, taken: 1 })).toBe(true);
    expect(secondRageOption({ oneOption: true, raging: true, taken: 0 })).toBe(false);
  });
  it("outside Rage, or without the rule, nothing to refuse", () => {
    expect(secondRageOption({ oneOption: true, raging: false, taken: 1 })).toBe(false);
    expect(secondRageOption({ oneOption: false, raging: true, taken: 1 })).toBe(false);
    expect(secondRageOption()).toBe(false);
  });
  it("the key is validated", () => {
    expect(validateEntry({ duringRage: { copiesEnd: true, oneOption: true } })).toEqual([]);
    expect(validateEntry({ duringRage: { oneOption: 1 } })).toHaveLength(1);
  });
});

describe("usageLimits.light: only in Dim Light or Darkness (One with Shadows)", () => {
  const rule = { light: ["dim", "dark"] };
  const at = light => usageLimitIssues(rule, { inCombat: false, ownTurn: true, usedThisTurn: false, remaining: null, light });
  it("Dim Light, Darkness: nothing to reproach; Bright Light: \"wrongLight\"", () => {
    expect(at("dim")).toEqual([]);
    expect(at("dark")).toEqual([]);
    expect(at("bright")).toEqual(["wrongLight"]);
  });
  it("unknown light (no token on the scene): nothing is reproached", () => {
    expect(at(null)).toEqual([]);
    expect(at(undefined)).toEqual([]);
  });
  it("without the key, light does not count", () => {
    const state = { inCombat: false, ownTurn: true, usedThisTurn: false, remaining: null, light: "bright" };
    expect(usageLimitIssues({}, state)).toEqual([]);
  });
});
