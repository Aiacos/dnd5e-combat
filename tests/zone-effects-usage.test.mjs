import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readUsage } from "../module/scripts/adapter/usage.mjs";

// §226: the effects of a `zoneEffects` item are carried by its area (the core's `applyActiveEffect` behavior) — the use never
// places them on the targets, whatever the activity's type. Synthetic examples, without Foundry: `identifier` of a shipped spell
// `zoneEffects` (Silence), another one without the key.
const saved = {};
beforeAll(() => {
  for ( const key of ["game", "fromUuidSync"] ) saved[key] = globalThis[key];
  globalThis.game = { settings: { get: () => ({}) }, user: { isGM: false }, actors: { get: () => null } };
  globalThis.fromUuidSync = () => null;
});
afterAll(() => {
  for ( const [key, value] of Object.entries(saved) ) globalThis[key] = value;
});

const effect = { _id: "effAAAAAAAAAAAAA" };
const itemOf = identifier => ({ name: identifier, type: "feat", flags: {}, system: { identifier }, effects: { get: () => null } });
const activityOf = (identifier, type, extra={}) => ({
  id: "actAAAAAAAAAAAAA", uuid: `Item.x.Activity.${type}`, type, item: itemOf(identifier), effects: [effect], target: {}, range: {}, ...extra
});
const messageOf = activity => ({
  id: "msgAAAAAAAAAAAAA", system: { targets: [{ token: "Scene.s.Token.t", actor: "Actor.a", name: "Zombi" }] }, speaker: {},
  flags: {}, getFlag: () => undefined, getAssociatedActivity: () => activity, getAssociatedActor: () => null
});

describe("effects carried by the area (§226)", () => {
  it("utility: a `zoneEffects` item has nothing to resolve, another places its effects", () => {
    expect(readUsage(messageOf(activityOf("silence", "utility")))).toBeNull();
    expect(readUsage(messageOf(activityOf("sans-zone", "utility")))?.plan.effects.map(e => e.id)).toEqual([effect._id]);
  });
  it("save, damage, healing: the plan stays, without effects on the targets", () => {
    const save = { save: { ability: new Set(["con"]), dc: { value: 15 } }, damage: { parts: [{ number: 2, denomination: 10 }] } };
    const damage = { damage: { parts: [{ number: 2, denomination: 10 }] } };
    const heal = { healing: { formula: "1d8" } };
    for ( const [type, extra] of [["save", save], ["damage", damage], ["heal", heal]] ) {
      expect(readUsage(messageOf(activityOf("silence", type, extra)))?.plan.effects, type).toEqual([]);
      expect(readUsage(messageOf(activityOf("sans-zone", type, extra)))?.plan.effects.map(e => e.id), type).toEqual([effect._id]);
    }
  });
});
