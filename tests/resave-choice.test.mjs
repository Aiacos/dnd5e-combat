/**
 * §485: replaying as a reaction the save of a carried effect (Indomitable) — validation of `resave.own`, the effects that can be
 * replayed (`savableEffectsOf`, fact `self.hasSavableEffect`). Synthetic examples.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

const uuids = new Map();
let savableEffectsOf, factsFor;

const facts = { "self.hasSavableEffect": true, "self.hasEffect": true };
const v = entry => validateEntry(entry, { facts });
const indomitable = (step={ type: "resave", own: "choose" }, extra={}) =>
  ({ triggers: [{ on: "enemyTurnEnd", if: { "self.hasSavableEffect": true }, do: [{ type: "use", target: "self" }, step], ...extra }] });

/** An item of an actor, its activities by id; each activity knows its item. */
function itemOf(actor, id, activities=[]) {
  const item = { id, name: id, documentName: "Item", actor, uuid: `Actor.${actor.id}.Item.${id}`, system: { identifier: id } };
  const list = activities.map(a => ({ ...a, item, uuid: `${item.uuid}.Activity.${a.id}` }));
  item.system.activities = list;
  for ( const a of list ) uuids.set(a.uuid, a);
  uuids.set(item.uuid, item);
  return item;
}
const actorOf = id => ({ id, effects: [], items: [], statuses: new Set() });
/** An effect placed on `bearer` by the activity `activity` (copy of the item's effect `effectId`). */
function effectBy(bearer, activity, effectId, extra={}) {
  const e = { id: `on-${effectId}`, name: effectId, uuid: `Actor.${bearer.id}.ActiveEffect.on-${effectId}`, disabled: false, isSuppressed: false,
    statuses: new Set(), flags: {}, getFlag: () => undefined, origin: activity?.item?.uuid ?? null,
    _stats: { duplicateSource: activity ? `${activity.item.uuid}.ActiveEffect.${effectId}` : null },
    system: { origin: { activity: activity?.uuid ?? null } }, ...extra };
  bearer.effects.push(e);
  return e;
}

beforeAll(async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
  globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
    i18n: { localize: k => k, format: k => k, lang: "en" }, messages: { get: () => null } };
  globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
  globalThis.fromUuidSync = uuid => uuids.get(uuid) ?? null;
  globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
  await import("../module/scripts/adapter/content.mjs");   // l'ordre du module : content charge facts avant KNOWN_FACTS
  ({ savableEffectsOf, factsFor } = await import("../module/scripts/adapter/facts.mjs"));
});

describe("§485 : validation de resave.own", () => {
  it("a reaction of the item, at the end of an enemy's turn, with its use step", () => {
    expect(v(indomitable())).toEqual([]);
    expect(v(indomitable({ type: "resave", own: "choose", advantage: true }))).toEqual([]);
  });
  it("refuses another value, other options, another moment, via, or without use", () => {
    expect(v(indomitable({ type: "resave", own: "all" }))).toEqual(["triggers[0].do[1].own: choose"]);
    expect(v(indomitable({ type: "resave", own: "choose", tally: { successes: 3, failures: 3 } })))
      .toEqual(["triggers[0].do[1].own: no tally with own (advantage only)"]);
    const misplaced = "triggers[0].do: \"resave\" with own requires enemyTurnEnd as the only moment, no via, and a \"use\" reaction";
    expect(v({ triggers: [{ on: "endOfTurn", do: [{ type: "use" }, { type: "resave", own: "choose" }] }] })).toEqual([misplaced]);
    expect(v({ triggers: [{ on: "enemyTurnEnd", do: [{ type: "resave", own: "choose" }] }] })).toEqual([misplaced]);
    expect(v({ triggers: [{ on: "enemyTurnEnd", via: "effect", do: [{ type: "use" }, { type: "resave", own: "choose" }] }] })).toContain(misplaced);
  });
  it("the usual repeated save does not change", () => {
    expect(v({ triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }] })).toEqual([]);
    expect(v({ triggers: [{ on: "enemyTurnEnd", do: [{ type: "use" }, { type: "resave" }] }] })[0]).toMatch(/requires moments among/);
  });
});

describe("§485: the effects whose save can be replayed", () => {
  const bearer = actorOf("bearer");
  const caster = actorOf("caster");
  const hold = itemOf(caster, "hold", [{ id: "holdSave00000000", type: "save", effects: [{ _id: "holdEffect000000" }], save: { dc: { value: 15 } } }]);
  const halfOnSave = itemOf(caster, "half", [{ id: "halfSave00000000", type: "save", effects: [{ _id: "halfEffect000000", onSave: true }] }]);
  const blade = itemOf(caster, "blade", [{ id: "bladeAttack00000", type: "attack", effects: [] }, { id: "bladeSave0000000", type: "save", effects: [] }]);
  const blessing = itemOf(caster, "blessing", [{ id: "blessUtility0000", type: "utility", effects: [] }]);
  const own = itemOf(bearer, "own", [{ id: "ownSave000000000", type: "save", effects: [] }]);

  it("keeps the effect of another's save, and the sister save of an attack", () => {
    const held = effectBy(bearer, hold.system.activities[0], "holdEffect000000");
    const struck = effectBy(bearer, blade.system.activities[0], "bladeEffect00000");
    const found = savableEffectsOf(bearer);
    expect(found.map(f => f.effect)).toEqual([held, struck]);
    expect(found.map(f => f.activity.id)).toEqual(["holdSave00000000", "bladeSave0000000"]);
  });
  it("excludes: without a save, placed on a success, its own effects, its Concentration, disabled", () => {
    const b = actorOf("b2");
    effectBy(b, blessing.system.activities[0], "blessEffect00000");
    effectBy(b, halfOnSave.system.activities[0], "halfEffect000000");
    effectBy(b, own.system.activities[0], "ownEffect0000000");
    effectBy(b, hold.system.activities[0], "holdEffect000000", { disabled: true });
    effectBy(b, hold.system.activities[0], "holdEffect000000", { statuses: new Set(["concentrating"]) });
    effectBy(b, null, "orphan0000000000");
    own.actor = b;
    expect(savableEffectsOf(b)).toEqual([]);
  });
  it("le fait self.hasSavableEffect", () => {
    const empty = actorOf("empty");
    expect(factsFor({ self: bearer })["self.hasSavableEffect"](true)).toBe(true);
    expect(factsFor({ self: empty })["self.hasSavableEffect"](true)).toBe(false);
    expect(factsFor({ self: empty })["self.hasSavableEffect"](false)).toBe(true);
  });
});
