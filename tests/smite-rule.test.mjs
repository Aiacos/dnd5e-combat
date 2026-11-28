import { describe, it, expect } from "vitest";
import { smiteRuleOf } from "../module/scripts/adapter/smite.mjs";

/** An activity collection Foundry-style: get / find. */
const coll = list => ({ get: id => list.find(a => a.id === id), find: f => list.find(f) });
const dice = (n, d) => ({ parts: [{ number: n, denomination: d }] });

describe("a smite's rule according to the spell's copy (§128)", () => {
  const rule = { damage: "M4KS57lcf4K6fUMU", effect: "A0tTvLeRetrC708K" };
  it("the compendium spell: the rule as is", () => {
    const item = { system: { activities: coll([{ id: "dnd5eactivity000", damage: dice(1, 6) }, { id: "M4KS57lcf4K6fUMU", damage: dice(1, 6) }]) } };
    expect(smiteRuleOf(item, rule)).toBe(rule);
  });
  it("the pregens' copy (a save carrying the dice): its activity, the effect if it is there", () => {
    const item = { system: { activities: coll([{ id: "dnd5eactivity000", damage: dice(1, 6) }]) },
      effects: { get: id => (id === "A0tTvLeRetrC708K" ? {} : undefined) } };
    expect(smiteRuleOf(item, rule)).toMatchObject({ damage: "dnd5eactivity000", effect: "A0tTvLeRetrC708K" });
  });
  it("no activity with dice: nothing", () => {
    const item = { system: { activities: coll([{ id: "dnd5eactivity000", damage: { parts: [] } }]) }, effects: { get: () => undefined } };
    expect(smiteRuleOf(item, rule)).toBeNull();
  });
  it("the declared save is not taken for the damage", () => {
    const item = { system: { activities: coll([{ id: "save1", damage: dice(2, 6) }]) }, effects: { get: () => undefined } };
    expect(smiteRuleOf(item, { damage: "absent", save: "save1" })).toBeNull();
  });
});
