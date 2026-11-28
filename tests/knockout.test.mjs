import { describe, it, expect } from "vitest";
import { nonLethalAttackerOf, knockOutAtZero } from "../module/scripts/adapter/knockout.mjs";

// An actor, a damage message and its activity, without Foundry.
const actorWith = nonLethal => ({ name: "Guerrier", getFlag: (scope, key) => (key === "nonLethal" ? nonLethal : undefined) });
const options = ({ nonLethal=true, type="attack", range="melee", mode="" }={}) => {
  const activity = { type, actor: actorWith(nonLethal), attack: { type: { value: range } } };
  return { originatingMessage: { getAssociatedActivity: () => activity, rolls: [{ options: { attackMode: mode } }] } };
};
const target = hp => ({ system: { attributes: { hp: { value: hp, max: 20 } } } });

describe("assommer (§210)", () => {
  it("a melee attack by an actor with non-lethal blows", () => {
    expect(nonLethalAttackerOf(options())?.name).toBe("Guerrier");
    expect(nonLethalAttackerOf(options({ nonLethal: false }))).toBeNull();
    expect(nonLethalAttackerOf(options({ range: "ranged" }))).toBeNull();
    expect(nonLethalAttackerOf(options({ mode: "thrown" }))).toBeNull();     // a thrown melee weapon
    expect(nonLethalAttackerOf(options({ type: "save" }))).toBeNull();       // not an attack
  });
  it("damage that would drop to 0 HP leaves at 1 HP; otherwise nothing", () => {
    const updates = {};
    expect(knockOutAtZero(target(8), 12, updates, options())).toBe("Guerrier");
    expect(updates["system.attributes.hp.value"]).toBe(1);
    const none = {};
    expect(knockOutAtZero(target(8), 5, none, options())).toBeNull();          // does not drop
    expect(knockOutAtZero(target(0), 5, none, options())).toBeNull();          // already at 0
    expect(knockOutAtZero(target(8), 12, none, options({ nonLethal: false }))).toBeNull();
    expect(none).toEqual({});
  });
});
