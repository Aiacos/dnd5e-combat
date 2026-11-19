/**
 * `declaresKey` (adapter/content.mjs) : une couche de l'item porte-t-elle une clé ? — la question posée avant de composer l'entrée
 * entière (`contentOf`) quand on ne cherche qu'une clé rare sur tous les objets d'une fiche. La vue le fait à chaque
 * rafraîchissement (ui/perception.mjs, `grantAll` → `ownDarknessSight`, §447) pour chaque token doté de la vue.
 * Rien n'est gardé en mémoire : chaque réponse est relue sur les objets, la surcouche du monde et les tables du moment.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";
import { CONTENT, registerTable, unregisterTable } from "../module/scripts/content/index.mjs";
import { CONTENT_VERSION } from "../module/scripts/core/content.mjs";

const MODULE_ID = "dnd5e-combat";
let contentOf, declaresKey, ownDarknessSight;
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
  ({ contentOf, declaresKey } = await import("../module/scripts/adapter/content.mjs"));
  ({ ownDarknessSight } = await import("../module/scripts/adapter/vision.mjs"));
}, 60000);

beforeEach(() => { overrides = {}; settingReads = 0; });

describe("declaresKey : jamais « non » pour une clé que l'entrée composée porte", () => {
  it("contenu livré : chaque identifiant × chaque clé du schéma, comme `contentOf`", () => {
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

  it("chaque couche compte : flag de l'item, surcouche du monde, enchantement de l'item, texte d'une capacité de PNJ", () => {
    const actor = actorOf([]);
    const plain = itemOf(actor, "plain-feature");
    expect(declaresKey(plain, "seesThroughOwnDarkness")).toBe(false);
    expect(contentOf(plain).entry).toBeNull();

    const flagged = itemOf(actor, "plain-feature", { flags: { [MODULE_ID]: { seesThroughOwnDarkness: true } } });
    expect(declaresKey(flagged, "seesThroughOwnDarkness")).toBe(true);
    expect(contentOf(flagged).entry.seesThroughOwnDarkness).toBe(true);

    overrides = { "plain-feature": { seesThroughOwnDarkness: true } };
    expect(declaresKey(plain, "seesThroughOwnDarkness")).toBe(true);
    expect(contentOf(plain).entry.seesThroughOwnDarkness).toBe(true);
    overrides = {};

    // L'enchantement de la Langue de feu (`flame-tongue-enchanted`), reconnu par l'objet qui l'a posé.
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

describe("§447 : voir à travers ses propres Ténèbres, relu à chaque demande", () => {
  const plain = Array.from({ length: 30 }, (_, n) => `plain-feature-${n}`);

  it("un objet ajouté, changé, retiré compte à la demande suivante", () => {
    const actor = actorOf(plain);
    const token = tokenOf(actor);
    expect(ownDarknessSight(token)).toBeNull();
    actor.items.push(itemOf(actor, "power-of-shadow"));           // ajouté
    expect(ownDarknessSight(token)).toBe(actor);
    actor.items.at(-1).system.identifier = "plain-renamed";       // changé
    expect(ownDarknessSight(token)).toBeNull();
    actor.items.at(-1).flags[MODULE_ID] = { seesThroughOwnDarkness: true };   // un flag posé sur l'objet
    expect(ownDarknessSight(token)).toBe(actor);
    actor.items.pop();                                            // retiré
    expect(ownDarknessSight(token)).toBeNull();
  });

  it("la surcouche du monde et la table d'un autre module comptent dès qu'elles changent", () => {
    const actor = actorOf(plain);
    const token = tokenOf(actor);
    overrides = { "plain-feature-7": { seesThroughOwnDarkness: true } };
    expect(ownDarknessSight(token)).toBe(actor);
    overrides = {};
    expect(ownDarknessSight(token)).toBeNull();
    registerTable("test-module", { "plain-feature-3": { seesThroughOwnDarkness: true } });
    expect(ownDarknessSight(token)).toBe(actor);
    unregisterTable("test-module");
    expect(ownDarknessSight(token)).toBeNull();
  });

  it("un effet d'enchantement posé sur un objet, puis désactivé", () => {
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

  it("une fiche de 30 objets sans rien de tel : la surcouche du monde est lue une fois, pas une fois par objet", () => {
    const actor = actorOf(plain);
    expect(ownDarknessSight(tokenOf(actor))).toBeNull();
    expect(settingReads).toBe(1);
  });

  it("sans acteur : null", () => {
    expect(ownDarknessSight({ actor: null })).toBeNull();
    expect(ownDarknessSight(null)).toBeNull();
  });
});

describe("les clés d'entrée des flags d'un item", () => {
  it("les mêmes clés, dans le même ordre, que le parcours du schéma entier — flags tirés au hasard", async () => {
    const { entryKeysOf } = await import("../module/scripts/adapter/content.mjs");
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for ( let n = 0; n < 500; n++ ) {
      const flags = {};
      const count = Math.floor(random() * 6);
      // Des clés du schéma dans un ordre quelconque, mêlées à des flags qui ne sont pas des clés d'entrée.
      for ( let k = 0; k < count; k++ ) flags[ENTRY_KEYS[Math.floor(random() * ENTRY_KEYS.length)]] = k;
      if ( random() < 0.5 ) flags.resolution = { step: "done" };
      if ( random() < 0.3 ) flags.toString = "x";
      expect(entryKeysOf(flags)).toEqual(ENTRY_KEYS.filter(key => key in flags));
    }
    expect(entryKeysOf({})).toEqual([]);
  });
});

