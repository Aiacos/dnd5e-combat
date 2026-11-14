import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { outcomeSourcesOf } from "../module/scripts/adapter/usage.mjs";

// §445 : les items dont les déclarations (dégâts en plus, étapes d'issue) valent pour une utilisation, chacun une seule fois. dnd5e pose
// sur la copie d'un sort lancé par une activité « cast » un enchantement dont l'origine est cette activité (`system.origin.activity`) :
// la capacité qui lance le sort était lue deux fois, comme lanceur et comme enchanteur. Exemples synthétiques, sans Foundry.
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
/** Un item de l'acteur, avec une activité enregistrée sous son uuid (l'origine d'un enchantement est l'activité). */
const itemOf = (actor, id, name, { effects=[], flags={} }={}) => {
  const item = { id, name, documentName: "Item", uuid: `${ACTOR}.Item.${id}`, actor, flags, system: { identifier: name },
    effects: new Map(effects.map(e => [e._id, e])) };
  docs.set(`${ACTOR}.Item.${id}.Activity.castAAAAAAAAAAAA`, { item, documentName: undefined });
  docs.set(`${ACTOR}.Item.${id}.Activity.enchAAAAAAAAAAAA`, { item, documentName: undefined });
  return item;
};
/** L'enchantement « Spell Changes » de la copie : avec son origine (forme de dnd5e 6.1), ou sans (forme d'avant). */
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

describe("sources des étapes d'issue, une fois chacune (§445)", () => {
  it("copie d'un sort lancé par une capacité, enchantement d'origine renseignée (dnd5e 6.1) : la capacité une seule fois", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "abilAAAAAAAAAAAA", "capacité qui lance"));
    const copy = copyOf(actor, "abilAAAAAAAAAAAA", [castChanges("abilAAAAAAAAAAAA")]);
    expect(names(outcomeSourcesOf(copy))).toEqual(["copie du sort", "capacité qui lance"]);
  });

  it("même copie, enchantement sans origine (forme d'avant) : même résultat", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "abilAAAAAAAAAAAA", "capacité qui lance"));
    const copy = copyOf(actor, "abilAAAAAAAAAAAA", [castChanges("abilAAAAAAAAAAAA", false)]);
    expect(names(outcomeSourcesOf(copy))).toEqual(["copie du sort", "capacité qui lance"]);
  });

  it("arme enchantée par un autre item (pacte, infusion) : l'enchanteur compte, une fois", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "pactAAAAAAAAAAAA", "enchanteur"));
    const weapon = actor.add(itemOf(actor, "weapAAAAAAAAAAAA", "arme", { effects: [enchantmentBy("enchAAAAAAAAAAA1", "pactAAAAAAAAAAAA")] }));
    expect(names(outcomeSourcesOf(weapon))).toEqual(["arme", "enchanteur"]);
  });

  it("sort lancé par un objet magique et enchanté par un autre item : l'objet et l'autre item, chacun une fois", () => {
    const actor = actorWith();
    actor.add(itemOf(actor, "wandAAAAAAAAAAAA", "objet qui lance"));
    actor.add(itemOf(actor, "pactAAAAAAAAAAAA", "enchanteur"));
    const copy = copyOf(actor, "wandAAAAAAAAAAAA", [castChanges("wandAAAAAAAAAAAA"), enchantmentBy("enchAAAAAAAAAAA1", "pactAAAAAAAAAAAA")]);
    expect(names(outcomeSourcesOf(copy))).toEqual(["copie du sort", "objet qui lance", "enchanteur"]);
  });

  it("deux enchantements du même item : il compte une fois ; un enchantement coupé ne compte pas", () => {
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
