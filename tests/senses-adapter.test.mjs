/**
 * Declared senses read from actors (adapter/senses.mjs): by owning an item, by an effect it placed, from the content that another
 * module registers; protections carried by the target.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { CONTENT_VERSION } from "../module/scripts/core/content.mjs";
import { registerTable, unregisterTable } from "../module/scripts/content/index.mjs";

let declaredSensesOf, detectionWardsOf, sensedBy, detectedTypesOf, mutedSensesOf, forgetSenses;
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
/** An Active Effect placed by an item (its origin), copy of this item's effect `id`. */
const effectFrom = (item, id) => ({ id: `applied-${id}`, disabled: false, isSuppressed: false, origin: item.uuid,
  statuses: new Set(), _stats: { duplicateSource: `${item.uuid}.ActiveEffect.${id}` }, system: {} });
const tokenOf = (actor, x) => ({ actor, x, parent: { grid: { units: "ft" } } });
/** The scene between two test tokens: the distance along x; a wall, or not. */
const between = (a, b, walled) => ({ distance: () => Math.abs(a.x - b.x), walled });

beforeAll(async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
  const stored = { v: CONTENT_VERSION, entries: {} };
  const settings = { register() {}, get: (scope, key) => (key === "contentOverrides") ? stored : undefined };
  globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null }, settings,
    i18n: { localize: k => k, format: k => k, lang: "en" } };
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
  globalThis.fromUuidSync = uuid => uuids.get(uuid) ?? null;
  const movementUnits = { ft: { conversion: 1 }, m: { conversion: 3.28084 } };
  globalThis.CONFIG = { DND5E: { movementUnits }, specialStatusEffects: {}, queries: {} };
  ({ declaredSensesOf, detectionWardsOf, sensedBy, detectedTypesOf, mutedSensesOf, forgetSenses }
    = await import("../module/scripts/adapter/senses.mjs"));
}, 60000);

const PACK = "test-pack";
const TABLE = {
  "trait-sense": { sense: { kind: "locate", range: 60, walls: false, detects: { "target.creatureType": ["undead", "fiend"] } } },
  "spell-sense": { sense: { kind: "locate", range: 30, via: "effect", magic: "div" } },
  "two-effects": { sense: { kind: "locate", range: 60, via: "effect", fromEffect: "aaaaaaaaaaaaaaaa", magic: true } },
  "trait-sight": { sense: { kind: "sight", range: 30, walls: false, needs: "sight" } },
  "trait-dark-sight": { sense: { kind: "sight", range: 60, through: ["darkness"] } },
  "trait-echo": { sense: { kind: "locate", range: 30, needs: "hearing" } },
  "gift-as-undead": { detectedAs: ["undead"] },
  "trait-echolocation": { senseNeeds: { blindsight: "hearing" } },
  "ward-school": { wardsDetection: ["div"] },
  "ward-magic": { wardsDetection: ["magic"] }
};
afterEach(() => { unregisterTable(PACK); uuids.clear(); });

describe("an actor's declared senses", () => {
  it("by owning the item — from a table registered by another module", () => {
    registerTable(PACK, TABLE);
    expect(declaredSensesOf(actorOf("a", ["trait-sense", "multiattack"]))).toEqual([TABLE["trait-sense"].sense]);
    expect(declaredSensesOf(actorOf("b", ["multiattack"]))).toEqual([]);
  });
  it("a sense carried by an effect holds only as long as the effect is there", () => {
    registerTable(PACK, TABLE);
    const caster = actorOf("c", ["spell-sense"]);
    expect(declaredSensesOf(caster)).toEqual([]);
    // As in play: the effect created, then modified, makes what was read from the actor be forgotten (runtime/vision.mjs).
    caster.effects = [effectFrom(caster.items[0], "bbbbbbbbbbbbbbbb")];
    forgetSenses(caster);
    expect(declaredSensesOf(caster)).toEqual([TABLE["spell-sense"].sense]);
    caster.effects[0].disabled = true;
    forgetSenses(caster);
    expect(declaredSensesOf(caster)).toEqual([]);
  });
  it("`fromEffect`: that effect of the item, not another", () => {
    registerTable(PACK, TABLE);
    const actor = actorOf("d", ["two-effects"]);
    actor.effects = [effectFrom(actor.items[0], "cccccccccccccccc")];
    expect(declaredSensesOf(actor)).toEqual([]);
    actor.effects = [effectFrom(actor.items[0], "aaaaaaaaaaaaaaaa")];
    forgetSenses(actor);
    expect(declaredSensesOf(actor)).toEqual([TABLE["two-effects"].sense]);
  });
});

// Review of #119: `canSee` asks for these reads for each pair of tokens — they are kept per actor.
describe("what was read from an actor is kept, until something changes", () => {
  /** Counts the origin items looked up (`fromUuidSync`) during `fn`. */
  const lookups = fn => {
    const real = globalThis.fromUuidSync;
    let count = 0;
    globalThis.fromUuidSync = (...args) => { count++; return real(...args); };
    try { fn(); } finally { globalThis.fromUuidSync = real; }
    return count;
  };
  const warded = () => {
    const warder = actorOf("w", ["ward-school"]);
    const actor = actorOf("t", ["multiattack", "claw", "bite"]);
    actor.effects = [effectFrom(warder.items[0], "dddddddddddddddd"), effectFrom(warder.items[0], "eeeeeeeeeeeeeeee")];
    return actor;
  };

  it("a hundred requests: the effects' origin items are looked up only at the first", () => {
    registerTable(PACK, TABLE);
    const actor = warded();
    const first = lookups(() => { declaredSensesOf(actor); detectionWardsOf(actor); });
    expect(first).toBeGreaterThan(0);
    const again = lookups(() => { for ( let n = 0; n < 100; n++ ) { declaredSensesOf(actor); detectionWardsOf(actor); } });
    expect(again).toBe(0);
    expect(detectionWardsOf(actor)).toEqual(["div"]);
    expect(declaredSensesOf(actor)).toBe(declaredSensesOf(actor));
  });

  it("forgotten for the actor whose item or effect changes, not for the others", () => {
    registerTable(PACK, TABLE);
    const [one, other] = [warded(), warded()];
    detectionWardsOf(one);
    detectionWardsOf(other);
    one.effects = [];
    expect(detectionWardsOf(one)).toEqual(["div"]);   // nothing said it: the kept read
    forgetSenses(one);
    expect(detectionWardsOf(one)).toEqual([]);
    expect(lookups(() => detectionWardsOf(other))).toBe(0);
  });

  it("forgotten for everyone when the turn or the time advances (`forgetSenses()`)", () => {
    registerTable(PACK, TABLE);
    const actor = warded();
    detectionWardsOf(actor);
    actor.effects[0].isSuppressed = true;
    actor.effects[1].isSuppressed = true;
    forgetSenses();
    expect(detectionWardsOf(actor)).toEqual([]);
  });

  it("re-read by itself when a content table is registered or removed", () => {
    const actor = actorOf("a", ["trait-sense"]);
    expect(declaredSensesOf(actor)).toEqual([]);
    registerTable(PACK, TABLE);
    expect(declaredSensesOf(actor)).toEqual([TABLE["trait-sense"].sense]);
    unregisterTable(PACK);
    expect(declaredSensesOf(actor)).toEqual([]);
  });

  it("the returned array is shared: it is not modified", () => {
    registerTable(PACK, TABLE);
    const senses = declaredSensesOf(actorOf("a", ["trait-sense"]));
    expect(Object.isFrozen(senses)).toBe(true);
    expect(() => senses.push({})).toThrow();
  });
});

describe("what these senses say about a target", () => {
  const walled = () => true;
  it("locates the creature of the right type in range, through a wall if the sense passes through them", () => {
    registerTable(PACK, TABLE);
    const observer = tokenOf(actorOf("o", ["trait-sense"]), 0);
    const see = target => sensedBy(observer, target, between(observer, target, walled));
    expect(see(tokenOf(actorOf("u", [], { creatureType: "undead" }), 50))).toBe("locate");
    expect(see(tokenOf(actorOf("h", [], { creatureType: "humanoid" }), 50))).toBe(null);
    expect(see(tokenOf(actorOf("f", [], { creatureType: "fiend" }), 65))).toBe(null);
  });
  it("a wall stops the sense that does not pass through them", () => {
    registerTable(PACK, TABLE);
    const caster = actorOf("c", ["spell-sense"]);
    caster.effects = [effectFrom(caster.items[0], "bbbbbbbbbbbbbbbb")];
    const observer = tokenOf(caster, 0);
    const target = tokenOf(actorOf("t", []), 20);
    expect(sensedBy(observer, target, between(observer, target, () => false))).toBe("locate");
    expect(sensedBy(observer, target, between(observer, target, walled))).toBe(null);
  });
  it("the target protected against the spell's school is not found by it; a natural sense finds it", () => {
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
  it("a declared sight: through a wall if it passes through them, not an Invisible target, not if its bearer is Blinded", () => {
    registerTable(PACK, TABLE);
    const observer = tokenOf(actorOf("o", ["trait-sight"]), 0);
    const target = tokenOf(actorOf("t", []), 20);
    const scene = extra => ({ ...between(observer, target, walled), ...extra });
    expect(sensedBy(observer, target, scene({}))).toBe("sight");
    expect(sensedBy(observer, target, scene({ invisible: () => true }))).toBe(null);
    expect(sensedBy(observer, target, scene({ blind: () => true }))).toBe(null);
    expect(sensedBy(observer, target, scene({ deaf: () => true }))).toBe("sight");
    expect(sensedBy(observer, target, scene({ blocked: () => ({ fog: false, darkness: true }) }))).toBe(null);
  });
  it("Darkness does not stop the sight that pierces it; a fog does", () => {
    registerTable(PACK, TABLE);
    const observer = tokenOf(actorOf("o", ["trait-dark-sight"]), 0);
    const target = tokenOf(actorOf("t", []), 40);
    const scene = blocked => ({ ...between(observer, target, () => false), blocked: () => blocked });
    expect(sensedBy(observer, target, scene({ fog: false, darkness: true }))).toBe("sight");
    expect(sensedBy(observer, target, scene({ fog: true, darkness: true }))).toBe(null);
  });
  it("a locating sense ignores area and Invisible condition; `needs: \"hearing\"` turns it off for a Deafened bearer", () => {
    registerTable(PACK, TABLE);
    const observer = tokenOf(actorOf("o", ["trait-echo"]), 0);
    const target = tokenOf(actorOf("t", []), 20);
    const unread = () => { throw new Error("read"); };
    const scene = extra => ({ ...between(observer, target, () => false), invisible: unread, blocked: unread, ...extra });
    expect(sensedBy(observer, target, scene({}))).toBe("locate");
    expect(sensedBy(observer, target, scene({ deaf: () => true }))).toBe(null);
  });
  it("`detectedAs`: the sense that looks for Undead also finds whoever is perceived as such", () => {
    registerTable(PACK, TABLE);
    const observer = tokenOf(actorOf("o", ["trait-sense"]), 0);
    const plain = tokenOf(actorOf("h", [], { creatureType: "humanoid" }), 30);
    const gifted = tokenOf(actorOf("g", ["gift-as-undead"], { creatureType: "humanoid" }), 30);
    expect(detectedTypesOf(plain.actor)).toEqual([]);
    expect(detectedTypesOf(gifted.actor)).toEqual(["undead"]);
    expect(sensedBy(observer, plain, between(observer, plain, () => false))).toBe(null);
    expect(sensedBy(observer, gifted, between(observer, gifted, () => false))).toBe("locate");
  });
  it("`senseNeeds`: Blindsight by echolocation turns off for a Deafened bearer", () => {
    registerTable(PACK, TABLE);
    const actor = actorOf("b", ["trait-echolocation"]);
    const token = { ...tokenOf(actor, 0), hasStatusEffect: () => false };
    expect(mutedSensesOf(token)).toEqual([]);
    actor.statuses.add("deafened");
    expect(mutedSensesOf(token)).toEqual(["blindsight"]);
    const other = actorOf("p", []);
    other.statuses.add("deafened");
    expect(mutedSensesOf({ ...tokenOf(other, 0), hasStatusEffect: () => false })).toEqual([]);
  });
  it("without a declared sense: nothing, and the scene is not even read", () => {
    let asked = 0;
    const scene = { distance: () => { asked++; return 5; }, walled: () => { asked++; return false; } };
    expect(sensedBy(tokenOf(actorOf("o", ["multiattack"]), 0), tokenOf(actorOf("t", []), 5), scene)).toBe(null);
    expect(asked).toBe(0);
  });
});

describe("shipped content: Detect Magic", () => {
  let CONTENT, validateEntry, KNOWN_FACTS, senseVerdict, carriesMagic;
  beforeAll(async () => {
    ({ CONTENT } = await import("../module/scripts/content/index.mjs"));
    ({ validateEntry } = await import("../module/scripts/core/content/entry.mjs"));
    ({ KNOWN_FACTS } = await import("../module/scripts/adapter/content.mjs"));
    ({ senseVerdict } = await import("../module/scripts/core/senses.mjs"));
    ({ carriesMagic } = await import("../module/scripts/adapter/facts.mjs"));
  });
  it("the entry: an aura at 30 ft, by the spell's effect, a divination, on whoever carries magic", () => {
    const entry = CONTENT["detect-magic"];
    expect(validateEntry(entry, { facts: KNOWN_FACTS })).toEqual([]);
    expect(entry.sense).toMatchObject({ range: 30, via: "effect", magic: "div", reveals: "aura" });
    expect(entry.sense.detects).toEqual({ "target.carriesMagic": true });
    const at = (distance, extra={}) => ({ distance, walled: false, matches: true, wards: [], ...extra });
    expect(senseVerdict(entry.sense, at(30))).toBe("aura");
    expect(senseVerdict(entry.sense, at(35))).toBe(null);
    expect(senseVerdict(entry.sense, at(10, { walled: true }))).toBe(null);
    expect(senseVerdict(entry.sense, at(10, { wards: ["div"] }))).toBe(null);
  });
  it("carrying magic: an active magic effect, or a magic item on oneself — not in a bag, not a disabled effect", () => {
    const effect = extra => ({ disabled: false, isSuppressed: false, system: { magical: true }, ...extra });
    const item = (equipped, properties, container=null) => ({ system: { equipped, properties: new Set(properties), container } });
    expect(carriesMagic({ effects: [], items: [] })).toBe(false);
    expect(carriesMagic({ effects: [effect()], items: [] })).toBe(true);
    expect(carriesMagic({ effects: [effect({ disabled: true })], items: [] })).toBe(false);
    expect(carriesMagic({ effects: [effect({ isSuppressed: true })], items: [] })).toBe(false);
    expect(carriesMagic({ effects: [effect({ system: { magical: false } })], items: [] })).toBe(false);
    expect(carriesMagic({ effects: [], items: [item(true, ["mgc"])] })).toBe(true);
    // Carried without being equipped (a potion, a wand, a ring at the bottom of a pocket): it is seen.
    expect(carriesMagic({ effects: [], items: [item(false, ["mgc"])] })).toBe(true);
    expect(carriesMagic({ effects: [], items: [item(undefined, ["mgc"])] })).toBe(true);
    // Stowed in a container: no aura; equipped, it is seen even if the data says it is in a container.
    expect(carriesMagic({ effects: [], items: [item(false, ["mgc"], "sacAdosAdosAdos0")] })).toBe(false);
    expect(carriesMagic({ effects: [], items: [item(true, ["mgc"], "sacAdosAdosAdos0")] })).toBe(true);
    expect(carriesMagic({ effects: [], items: [item(false, ["fin"])] })).toBe(false);
    expect(carriesMagic({ effects: [], items: [item(true, ["fin"])] })).toBe(false);
    expect(carriesMagic(null)).toBe(false);
  });
});

describe("shipped content: spells and powers that declare a sense or a protection", () => {
  let CONTENT, factsFor, validateEntry, KNOWN_FACTS;
  beforeAll(async () => {
    ({ CONTENT } = await import("../module/scripts/content/index.mjs"));
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
    ({ validateEntry } = await import("../module/scripts/core/content/entry.mjs"));
    ({ KNOWN_FACTS } = await import("../module/scripts/adapter/content.mjs"));
  });
  const SENSES = ["detect-evil-and-good", "detect-poison-and-disease", "detect-thoughts", "channel-divinity-paladin",
    "channel-divinity"];
  const WARDS = { nondetection: ["div"], "mind-blank": ["magic"], sequester: ["div", "magic"] };

  it("each entry is valid, and its sense locates without seeing", () => {
    for ( const id of SENSES ) {
      expect(validateEntry(CONTENT[id], { facts: KNOWN_FACTS }), id).toEqual([]);
      expect(CONTENT[id].sense.kind, id).toBe("locate");
      expect(CONTENT[id].sense.via, id).toBe("effect");
    }
    for ( const [id, wards] of Object.entries(WARDS) ) expect(CONTENT[id].wardsDetection, id).toEqual(wards);
  });
  it("ranges and targets: six types at 30 ft, three at 60 ft through walls, the presence alone of whoever thinks", () => {
    const types = id => CONTENT[id].sense.detects["target.creatureType"];
    expect(CONTENT["detect-evil-and-good"].sense.range).toBe(30);
    expect([...types("detect-evil-and-good")].sort()).toEqual(["aberration", "celestial", "elemental", "fey", "fiend", "undead"]);
    expect(CONTENT["channel-divinity-paladin"].sense).toMatchObject({ range: 60, walls: false, fromEffect: "hr8wnlgs3uXphCnI" });
    expect([...types("channel-divinity-paladin")].sort()).toEqual(["celestial", "fiend", "undead"]);
    expect(CONTENT["detect-thoughts"].sense.reveals).toBe("presence");
    expect(CONTENT["detect-thoughts"].dataFixes).toHaveLength(1);
  });
  it("facts: a creature that knows a language or is telepathic; a venomous creature", () => {
    const languages = (value, custom="", telepathy=0) => ({ value: new Set(value), custom,
      communication: { telepathy: { value: telepathy } } });
    const targetWith = traits => ({ system: { traits: { languages: traits } }, items: [] });
    const speaks = traits => factsFor({ target: targetWith(traits) })["target.speaksLanguage"](true);
    expect(speaks(languages(["common"]))).toBe(true);
    expect(speaks(languages([], "Deep Speech"))).toBe(true);
    expect(speaks(languages([], "", 60))).toBe(true);
    expect(speaks(languages([]))).toBe(false);
    const weapon = (kind, types, parts=[]) => ({ type: "weapon", system: { type: { value: kind },
      damage: { base: { types: new Set(types) } },
      activities: [{ type: "attack", damage: { parts: parts.map(t => ({ types: new Set([t]) })) } }] } });
    const natural = (types, parts) => weapon("natural", types, parts);
    const poisonous = items => factsFor({ target: { system: {}, items } })["target.poisonous"](true);
    expect(poisonous([natural(["piercing"], ["poison"])])).toBe(true);
    expect(poisonous([natural(["poison"])])).toBe(true);
    expect(poisonous([natural(["piercing"])])).toBe(false);
    expect(poisonous([weapon("simpleM", ["poison"])])).toBe(false);
  });
});
