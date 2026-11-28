/**
 * `declaresKey` (adapter/content.mjs): does one of the item's layers carry a key? — the question asked before composing the
 * whole entry (`contentOf`) when looking only for a rare key across all the objects of a sheet. The view does it at each
 * refresh (ui/perception.mjs, `grantAll` → `ownDarknessSight`, §447) for every token with sight.
 * Nothing is kept in memory: every answer is re-read from the objects, the world overlay and the tables of the moment.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";
import { CONTENT, registerTable, unregisterTable } from "../module/scripts/content/index.mjs";
import { CONTENT_VERSION } from "../module/scripts/core/content.mjs";

const MODULE_ID = "dnd5e-combat";
let contentOf, declaresKey, ownDarknessSight, forgetWorldOverrides;

/** The GM writes the world overlay: the setting changes, its `onChange` makes it forget what had been read from it. */
const writeOverrides = entries => { overrides = entries; forgetWorldOverrides(); };
let overrides = {};
let settingReads = 0;

function itemOf(actor, identifier, extra={}) {
  return { id: `id-${identifier}`, name: identifier, type: "feat", flags: {}, effects: [], actor,
    uuid: `Actor.a.Item.${identifier}`, system: { identifier, activities: new Map(), description: { value: "" } }, ...extra };
}
function actorOf(identifiers, type="character") {
  const actor = { type, items: [] };
  actor.items = identifiers.map(identifier => itemOf(actor, identifier));
  return actor;
}
const tokenOf = actor => ({ actor });

beforeAll(async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
  globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null },
    i18n: { localize: k => k, format: k => k, lang: "en" },
    settings: { register() {}, get: (scope, key) => {
      if ( key !== "contentOverrides" ) return undefined;
      settingReads++;
      return { v: CONTENT_VERSION, entries: overrides };
    } } };
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
  globalThis.fromUuidSync = () => null;
  globalThis.CONFIG = { DND5E: {}, specialStatusEffects: {}, queries: {} };
  ({ contentOf, declaresKey, forgetWorldOverrides } = await import("../module/scripts/adapter/content.mjs"));
  ({ ownDarknessSight } = await import("../module/scripts/adapter/vision.mjs"));
}, 60000);

beforeEach(() => { writeOverrides({}); settingReads = 0; });

describe("declaresKey: never \"no\" for a key that the composed entry carries", () => {
  it("shipped content: every identifier × every schema key, like `contentOf`", () => {
    const actor = actorOf([]);
    let declared = 0;
    const wrong = [];
    for ( const identifier of Object.keys(CONTENT) ) {
      const item = itemOf(actor, identifier);
      const entry = contentOf(item).entry ?? {};
      for ( const key of ENTRY_KEYS ) {
        if ( key in entry ) declared++;
        if ( declaresKey(item, key) !== (key in entry) ) wrong.push(`${identifier}.${key}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(declared).toBeGreaterThan(800);
  });

  it("every layer counts: item flag, world overlay, item enchantment, text of an NPC ability", () => {
    const actor = actorOf([]);
    const plain = itemOf(actor, "plain-feature");
    expect(declaresKey(plain, "seesThroughOwnDarkness")).toBe(false);
    expect(contentOf(plain).entry).toBeNull();

    const flagged = itemOf(actor, "plain-feature", { flags: { [MODULE_ID]: { seesThroughOwnDarkness: true } } });
    expect(declaresKey(flagged, "seesThroughOwnDarkness")).toBe(true);
    expect(contentOf(flagged).entry.seesThroughOwnDarkness).toBe(true);

    writeOverrides({ "plain-feature": { seesThroughOwnDarkness: true } });
    expect(declaresKey(plain, "seesThroughOwnDarkness")).toBe(true);
    expect(contentOf(plain).entry.seesThroughOwnDarkness).toBe(true);
    writeOverrides({});

    // The Flame Tongue enchantment (`flame-tongue-enchanted`), recognized by the object that applied it.
    const source = itemOf(actor, "flame-tongue", { documentName: "Item" });
    globalThis.fromUuidSync = uuid => (uuid === "Actor.a.Item.flame-tongue" ? source : null);
    const enchantment = { id: "e1", type: "enchantment", disabled: false, isAppliedEnchantment: true,
      system: { origin: { activity: "Actor.a.Item.flame-tongue.Activity.act1" } } };
    const sword = itemOf(actor, "longsword", { effects: [enchantment] });
    expect(declaresKey(sword, "carriedLight")).toBe(true);
    expect(contentOf(sword).entry.carriedLight).toBeTruthy();
    expect(declaresKey(itemOf(actor, "longsword"), "carriedLight")).toBe(false);
    globalThis.fromUuidSync = () => null;

    const npc = actorOf([], "npc");
    const html = "<p>The target's Hit Point maximum decreases by an amount equal to the Necrotic damage taken, and the beast "
      + "regains Hit Points equal to that amount.</p>";
    const bite = itemOf(npc, "plain-bite", { system: { identifier: "plain-bite", description: { value: html },
      activities: new Map([["a", { id: "aaaaaaaaaaaaaaaa", type: "attack" }]]) } });
    expect(contentOf(bite).entry.drain).toBe(true);
    expect(declaresKey(bite, "drain")).toBe(true);
    expect(declaresKey(bite, "seesThroughOwnDarkness")).toBe(false);
  });
});

describe("§447: seeing through one's own Darkness, re-read on every request", () => {
  const plain = Array.from({ length: 30 }, (_, n) => `plain-feature-${n}`);

  it("an item added, changed, removed counts on the next request", () => {
    const actor = actorOf(plain);
    const token = tokenOf(actor);
    expect(ownDarknessSight(token)).toBeNull();
    actor.items.push(itemOf(actor, "power-of-shadow"));           // added
    expect(ownDarknessSight(token)).toBe(actor);
    actor.items.at(-1).system.identifier = "plain-renamed";       // changed
    expect(ownDarknessSight(token)).toBeNull();
    actor.items.at(-1).flags[MODULE_ID] = { seesThroughOwnDarkness: true };   // a flag set on the item
    expect(ownDarknessSight(token)).toBe(actor);
    actor.items.pop();                                            // removed
    expect(ownDarknessSight(token)).toBeNull();
  });

  it("the world overlay and another module's table count as soon as they change", () => {
    const actor = actorOf(plain);
    const token = tokenOf(actor);
    writeOverrides({ "plain-feature-7": { seesThroughOwnDarkness: true } });
    expect(ownDarknessSight(token)).toBe(actor);
    writeOverrides({});
    expect(ownDarknessSight(token)).toBeNull();
    registerTable("test-module", { "plain-feature-3": { seesThroughOwnDarkness: true } });
    expect(ownDarknessSight(token)).toBe(actor);
    unregisterTable("test-module");
    expect(ownDarknessSight(token)).toBeNull();
  });

  it("an enchantment effect set on an item, then disabled", () => {
    registerTable("test-module", { "shadow-oil-enchanted": { seesThroughOwnDarkness: true } });
    const actor = actorOf(plain);
    const oil = itemOf(actor, "shadow-oil", { documentName: "Item" });
    globalThis.fromUuidSync = uuid => (uuid === "Actor.a.Item.shadow-oil" ? oil : null);
    const enchantment = { id: "e1", type: "enchantment", disabled: false, isAppliedEnchantment: true,
      system: { origin: { activity: "Actor.a.Item.shadow-oil.Activity.act1" } } };
    expect(ownDarknessSight(tokenOf(actor))).toBeNull();
    actor.items[4].effects.push(enchantment);
    expect(ownDarknessSight(tokenOf(actor))).toBe(actor);
    enchantment.disabled = true;
    expect(ownDarknessSight(tokenOf(actor))).toBeNull();
    actor.items[4].effects.pop();
    unregisterTable("test-module");
    globalThis.fromUuidSync = () => null;
  });

  it("a sheet of 30 items with nothing of the kind: the world overlay is read once, not once per item", () => {
    const actor = actorOf(plain);
    expect(ownDarknessSight(tokenOf(actor))).toBeNull();
    expect(settingReads).toBe(1);
  });

  it("sans acteur : null", () => {
    expect(ownDarknessSight({ actor: null })).toBeNull();
    expect(ownDarknessSight(null)).toBeNull();
  });
});

describe("the entry keys of an item's flags", () => {
  it("the same keys, in the same order, as the walk of the whole schema — randomly drawn flags", async () => {
    const { entryKeysOf } = await import("../module/scripts/adapter/content.mjs");
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for ( let n = 0; n < 500; n++ ) {
      const flags = {};
      const count = Math.floor(random() * 6);
      // Schema keys in any order, mixed with flags that are not entry keys.
      for ( let k = 0; k < count; k++ ) flags[ENTRY_KEYS[Math.floor(random() * ENTRY_KEYS.length)]] = k;
      if ( random() < 0.5 ) flags.resolution = { step: "done" };
      if ( random() < 0.3 ) flags.toString = "x";
      expect(entryKeysOf(flags)).toEqual(ENTRY_KEYS.filter(key => key in flags));
    }
    expect(entryKeysOf({})).toEqual([]);
  });
});

describe("the world overlay is read only once, until the setting changes", () => {
  it("a hundred requests, one read of the setting; the setting changes: one more, and the new value", async () => {
    const { worldOverrides } = await import("../module/scripts/adapter/content.mjs");
    writeOverrides({ "plain-feature": { seesThroughOwnDarkness: true } });
    settingReads = 0;
    for ( let n = 0; n < 100; n++ ) worldOverrides();
    expect(settingReads).toBe(1);
    expect(worldOverrides()).toEqual({ "plain-feature": { seesThroughOwnDarkness: true } });
    writeOverrides({ "autre": { seesThroughOwnDarkness: true } });
    expect(worldOverrides()).toEqual({ "autre": { seesThroughOwnDarkness: true } });
    expect(settingReads).toBe(2);
  });

  it("another `game.settings` (another world): what had been read no longer holds", async () => {
    const { worldOverrides } = await import("../module/scripts/adapter/content.mjs");
    worldOverrides();
    const before = globalThis.game.settings;
    globalThis.game.settings = { ...before, get: () => ({ v: CONTENT_VERSION, entries: { ailleurs: { seesThroughOwnDarkness: true } } }) };
    try { expect(Object.keys(worldOverrides())).toEqual(["ailleurs"]); }
    finally { globalThis.game.settings = before; forgetWorldOverrides(); }
  });
});

