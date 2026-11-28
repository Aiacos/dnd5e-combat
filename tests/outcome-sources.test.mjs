import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { outcomeSourcesOf } from "../module/scripts/adapter/usage.mjs";

// §445: the items whose declarations (extra damage, outcome steps) apply to a use, each only once. dnd5e puts an enchantment on
// the copy of a spell cast by a "cast" activity, whose origin is that activity (`system.origin.activity`): the ability that casts
// the spell was read twice, as caster and as enchanter. Synthetic examples, without Foundry.
const docs = new Map();
const saved = {};
beforeAll(() => {
  for ( const key of ["game", "fromUuidSync"] ) saved[key] = globalThis[key];
  globalThis.game = { settings: { get: () => ({}) }, user: { isGM: false }, actors: { get: () => null }, messages: { get: () => null } };
  globalThis.fromUuidSync = uuid => docs.get(uuid) ?? null;
});
afterAll(() => {
  for ( const [key, value] of Object.entries(saved) ) globalThis[key] = value;
});

const ACTOR = "Actor.aaaaaaaaaaaaaaaa";
/** An item of the actor, with an activity recorded under its uuid (an enchantment's origin is the activity). */
const itemOf = (actor, id, name, { effects=[], flags={} }={}) => {
  const item = { id, name, documentName: "Item", uuid: `${ACTOR}.Item.${id}`, actor, flags, system: { identifier: name },
    effects: new Map(effects.map(e => [e._id, e])) };
  docs.set(`${ACTOR}.Item.${id}.Activity.castAAAAAAAAAAAA`, { item, documentName: undefined });
  docs.set(`${ACTOR}.Item.${id}.Activity.enchAAAAAAAAAAAA`, { item, documentName: undefined });
  return item;
};
/** The "Spell Changes" enchantment of the copy: with its origin (dnd5e 6.1 shape), or without (earlier shape). */
const castChanges = (casterId, withOrigin=true) => ({
  _id: "dnd5espellchange", type: "enchantment", disabled: false, isAppliedEnchantment: true,
  system: { origin: withOrigin ? { activity: `${ACTOR}.Item.${casterId}.Activity.castAAAAAAAAAAAA` } : {} }
});
const enchantmentBy = (id, enchanterId, { disabled=false }={}) => ({
  _id: id, type: "enchantment", disabled, isAppliedEnchantment: true,
  system: { origin: { activity: `${ACTOR}.Item.${enchanterId}.Activity.enchAAAAAAAAAAAA` } }
});
const actorWith = () => { const items = new Map(); return { items, add: item => { items.set(item.id, item); return item; } }; };
const copyOf = (actor, casterId, effects) => actor.add(itemOf(actor, "copyAAAAAAAAAAAA", "copie du sort", {
  effects, flags: { dnd5e: { cachedFor: `.Item.${casterId}.Activity.castAAAAAAAAAAAA` } }
}));
const names = items => items.map(i => i.name);

describe("sources of outcome steps, each once (§445)", () => {
  it("copy of a spell cast by an ability, enchantment with origin filled in (dnd5e 6.1): the ability only once", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "abilAAAAAAAAAAAA", "capacité qui lance"));
    const copy = copyOf(actor, "abilAAAAAAAAAAAA", [castChanges("abilAAAAAAAAAAAA")]);
    expect(names(outcomeSourcesOf(copy))).toEqual(["copie du sort", "capacité qui lance"]);
  });

  it("same copy, enchantment without origin (earlier shape): same result", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "abilAAAAAAAAAAAA", "capacité qui lance"));
    const copy = copyOf(actor, "abilAAAAAAAAAAAA", [castChanges("abilAAAAAAAAAAAA", false)]);
    expect(names(outcomeSourcesOf(copy))).toEqual(["copie du sort", "capacité qui lance"]);
  });

  it("weapon enchanted by another item (pact, infusion): the enchanter counts, once", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "pactAAAAAAAAAAAA", "enchanteur"));
    const weapon = actor.add(itemOf(actor, "weapAAAAAAAAAAAA", "arme", { effects: [enchantmentBy("enchAAAAAAAAAAA1", "pactAAAAAAAAAAAA")] }));
    expect(names(outcomeSourcesOf(weapon))).toEqual(["arme", "enchanteur"]);
  });

  it("spell cast by a magic item and enchanted by another item: the item and the other item, each once", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "wandAAAAAAAAAAAA", "objet qui lance"));
    actor.add(itemOf(actor, "pactAAAAAAAAAAAA", "enchanteur"));
    const copy = copyOf(actor, "wandAAAAAAAAAAAA", [castChanges("wandAAAAAAAAAAAA"), enchantmentBy("enchAAAAAAAAAAA1", "pactAAAAAAAAAAAA")]);
    expect(names(outcomeSourcesOf(copy))).toEqual(["copie du sort", "objet qui lance", "enchanteur"]);
  });

  it("two enchantments from the same item: it counts once; a disabled enchantment does not count", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "pactAAAAAAAAAAAA", "enchanteur"));
    actor.add(itemOf(actor, "offfAAAAAAAAAAAA", "enchanteur coupé"));
    const weapon = actor.add(itemOf(actor, "weapAAAAAAAAAAAA", "arme", { effects: [
      enchantmentBy("enchAAAAAAAAAAA1", "pactAAAAAAAAAAAA"), enchantmentBy("enchAAAAAAAAAAA2", "pactAAAAAAAAAAAA"),
      enchantmentBy("enchAAAAAAAAAAA3", "offfAAAAAAAAAAAA", { disabled: true })
    ] }));
    expect(names(outcomeSourcesOf(weapon))).toEqual(["arme", "enchanteur"]);
  });

  it("un item sans lanceur ni enchantement : lui seul ; rien : rien", () => {
    const actor = actorWith();
    const plain = actor.add(itemOf(actor, "plainAAAAAAAAAAA".slice(0, 16), "simple"));
    expect(names(outcomeSourcesOf(plain))).toEqual(["simple"]);
    expect(outcomeSourcesOf(null)).toEqual([]);
  });
});
