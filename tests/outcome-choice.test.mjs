import { describe, it, expect } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { applicationPlan, OUTCOME_DAMAGE, OUTCOME_GRAPPLE } from "../module/scripts/core/action.mjs";

const target = token => ({ token, actor: `Actor.${token}`, name: token, ac: 10, hit: true, critical: false, unaffected: null, save: null,
  damage: null, effects: [], times: 1, halved: false, sculpted: false, evasion: false });
const resolution = choice => ({
  plan: { attack: true, damage: { parts: [] }, save: null, heal: false, darts: 0, effects: [{ id: "Item.x.ActiveEffect.curse", activity: "a" }], steps: [],
    choice: { outcome: { escapeDc: 11 }, options: [{ id: OUTCOME_DAMAGE, label: "d" }, { id: OUTCOME_GRAPPLE, label: "g" }] } },
  targets: [target("A")], choice, step: "awaitingRolls", pending: []
});

describe("§504 (B24): grapple instead of dealing the damage", () => {
  it("schema: choice { outcome: [\"damage\", \"grapple\"], grapple: { escapeDc } }", () => {
    expect(validateEntry({ choice: { outcome: ["damage", "grapple"], grapple: { escapeDc: 11 } } })).toEqual([]);
    expect(validateEntry({ choice: { outcome: ["grapple", "damage"] } })).toEqual([]);
    expect(validateEntry({ choice: { outcome: ["damage"] } })).toEqual([expect.stringContaining("outcome")]);
    expect(validateEntry({ choice: { outcome: ["damage", "grapple"], effects: "one" } })).toEqual([expect.stringContaining("alone")]);
    expect(validateEntry({ choice: { outcome: ["damage", "grapple"], grapple: { escapeDc: 0 } } })).toEqual([expect.stringContaining("grapple")]);
    expect(validateEntry({ choice: { effects: "one", grapple: { escapeDc: 11 } } })).toEqual([expect.stringContaining("only with outcome")]);
    expect(validateEntry({ choice: { effects: "one" } })).toEqual([]);
  });
  it("damage chosen: multiplier 1, no grapple", () => {
    const [entry] = applicationPlan(resolution(OUTCOME_DAMAGE));
    expect(entry.multiplier).toBe(1);
    expect(entry.steps).toEqual([]);
    expect(entry.effects.map(e => e.id)).toEqual(["Item.x.ActiveEffect.curse"]);   // the hit's effects remain
  });
  it("grapple chosen: no damage, Grappled at the declared escape DC", () => {
    const [entry] = applicationPlan(resolution(OUTCOME_GRAPPLE));
    expect(entry.multiplier).toBe(0);
    expect(entry.steps).toEqual([{ type: "status", status: "grappled", escapeDc: 11 }]);
    expect(entry.effects.map(e => e.id)).toEqual(["Item.x.ActiveEffect.curse"]);
  });
});
