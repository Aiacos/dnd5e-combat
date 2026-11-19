/**
 * Sens déclarés lus sur les acteurs (adapter/senses.mjs) : par la possession d'un item, par un effet qu'il a posé, depuis le
 * contenu qu'un autre module enregistre ; protections portées par la cible.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { CONTENT_VERSION } from "../module/scripts/core/content.mjs";
import { registerTable, unregisterTable } from "../module/scripts/content/index.mjs";

let declaredSensesOf, detectionWardsOf, sensedBy;
const uuids = new Map();

function itemOf(actor, identifier, extra={}) {
  const system = { identifier, activities: new Map(), description: { value: "" } };
  const item = { id: `id-${identifier}`, name: identifier, type: "feat", documentName: "Item", flags: {}, effects: [], actor,
    uuid: `Actor.${actor.id}.Item.${identifier}`, system, ...extra };
  uuids.set(item.uuid, item);
  return item;
}
function actorOf(id, identifiers, { type="npc", creatureType="humanoid" }={}) {
  const actor = { id, type, items: [], effects: [], statuses: new Set(), system: { details: { type: { value: creatureType } } } };
  actor.items = identifiers.map(identifier => itemOf(actor, identifier));
  return actor;
}
/** Un effet actif posé par un item (son origine), copie de l'effet `id` de cet item. */
const effectFrom = (item, id) => ({ id: `applied-${id}`, disabled: false, isSuppressed: false, origin: item.uuid,
  statuses: new Set(), _stats: { duplicateSource: `${item.uuid}.ActiveEffect.${id}` }, system: {} });
const tokenOf = (actor, x) => ({ actor, x, parent: { grid: { units: "ft" } } });
/** La scène entre deux tokens du test : la distance le long de x ; un mur, ou non. */
const between = (a, b, walled) => ({ distance: () => Math.abs(a.x - b.x), walled });

beforeAll(async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
  const settings = { register() {}, get: (scope, key) => (key === "contentOverrides") ? { v: CONTENT_VERSION, entries: {} } : undefined };
  globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null }, settings,
    i18n: { localize: k => k, format: k => k, lang: "en" } };
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
  globalThis.fromUuidSync = uuid => uuids.get(uuid) ?? null;
  const movementUnits = { ft: { conversion: 1 }, m: { conversion: 3.28084 } };
  globalThis.CONFIG = { DND5E: { movementUnits }, specialStatusEffects: {}, queries: {} };
  ({ declaredSensesOf, detectionWardsOf, sensedBy } = await import("../module/scripts/adapter/senses.mjs"));
}, 60000);

const PACK = "test-pack";
const TABLE = {
  "trait-sense": { sense: { kind: "locate", range: 60, walls: false, detects: { "target.creatureType": ["undead", "fiend"] } } },
  "spell-sense": { sense: { kind: "locate", range: 30, via: "effect", magic: "div" } },
  "two-effects": { sense: { kind: "locate", range: 60, via: "effect", fromEffect: "aaaaaaaaaaaaaaaa", magic: true } },
  "ward-school": { wardsDetection: ["div"] },
  "ward-magic": { wardsDetection: ["magic"] }
};
afterEach(() => { unregisterTable(PACK); uuids.clear(); });

describe("sens déclarés d'un acteur", () => {
  it("par la possession de l'item — depuis une table enregistrée par un autre module", () => {
    registerTable(PACK, TABLE);
    expect(declaredSensesOf(actorOf("a", ["trait-sense", "multiattack"]))).toEqual([TABLE["trait-sense"].sense]);
    expect(declaredSensesOf(actorOf("b", ["multiattack"]))).toEqual([]);
  });
  it("un sens porté par un effet ne vaut que tant que l'effet est là", () => {
    registerTable(PACK, TABLE);
    const caster = actorOf("c", ["spell-sense"]);
    expect(declaredSensesOf(caster)).toEqual([]);
    caster.effects = [effectFrom(caster.items[0], "bbbbbbbbbbbbbbbb")];
    expect(declaredSensesOf(caster)).toEqual([TABLE["spell-sense"].sense]);
    caster.effects[0].disabled = true;
    expect(declaredSensesOf(caster)).toEqual([]);
  });
  it("`fromEffect` : cet effet-là de l'item, pas un autre", () => {
    registerTable(PACK, TABLE);
    const actor = actorOf("d", ["two-effects"]);
    actor.effects = [effectFrom(actor.items[0], "cccccccccccccccc")];
    expect(declaredSensesOf(actor)).toEqual([]);
    actor.effects = [effectFrom(actor.items[0], "aaaaaaaaaaaaaaaa")];
    expect(declaredSensesOf(actor)).toEqual([TABLE["two-effects"].sense]);
  });
});

describe("ce que ces sens disent d'une cible", () => {
  const walled = () => true;
  it("localise la créature du bon type dans la portée, à travers un mur si le sens les traverse", () => {
    registerTable(PACK, TABLE);
    const observer = tokenOf(actorOf("o", ["trait-sense"]), 0);
    const see = target => sensedBy(observer, target, between(observer, target, walled));
    expect(see(tokenOf(actorOf("u", [], { creatureType: "undead" }), 50))).toBe("locate");
    expect(see(tokenOf(actorOf("h", [], { creatureType: "humanoid" }), 50))).toBe(null);
    expect(see(tokenOf(actorOf("f", [], { creatureType: "fiend" }), 65))).toBe(null);
  });
  it("un mur arrête le sens qui ne les traverse pas", () => {
    registerTable(PACK, TABLE);
    const caster = actorOf("c", ["spell-sense"]);
    caster.effects = [effectFrom(caster.items[0], "bbbbbbbbbbbbbbbb")];
    const observer = tokenOf(caster, 0);
    const target = tokenOf(actorOf("t", []), 20);
    expect(sensedBy(observer, target, between(observer, target, () => false))).toBe("locate");
    expect(sensedBy(observer, target, between(observer, target, walled))).toBe(null);
  });
  it("la cible protégée contre l'école du sort n'est pas trouvée par lui ; un sens naturel la trouve", () => {
    registerTable(PACK, TABLE);
    const caster = actorOf("c", ["spell-sense"]);
    caster.effects = [effectFrom(caster.items[0], "bbbbbbbbbbbbbbbb")];
    const warder = actorOf("w", ["ward-school"]);
    const hidden = actorOf("t", [], { creatureType: "undead" });
    hidden.effects = [effectFrom(warder.items[0], "dddddddddddddddd")];
    expect(detectionWardsOf(hidden)).toEqual(["div"]);
    const [spell, natural, target] = [tokenOf(caster, 0), tokenOf(actorOf("o", ["trait-sense"]), 0), tokenOf(hidden, 20)];
    expect(sensedBy(spell, target, between(spell, target, () => false))).toBe(null);
    expect(sensedBy(natural, target, between(natural, target, () => false))).toBe("locate");
  });
  it("sans sens déclaré : rien, et la scène n'est même pas lue", () => {
    let asked = 0;
    const scene = { distance: () => { asked++; return 5; }, walled: () => { asked++; return false; } };
    expect(sensedBy(tokenOf(actorOf("o", ["multiattack"]), 0), tokenOf(actorOf("t", []), 5), scene)).toBe(null);
    expect(asked).toBe(0);
  });
});
