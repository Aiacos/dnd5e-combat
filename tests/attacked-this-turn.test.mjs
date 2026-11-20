/**
 * §492 : qui a attaqué qui pendant le tour — registre sur le Combat, fait `source.attackedSelfThisTurn`. Exemple générique : une créature
 * qui riposte en réaction quand un ennemi finit son tour après l'avoir attaquée au corps à corps.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { attackKindOf, recordAttack, attacksDuring, attackedMatches, validAttackedArg } from "../module/scripts/core/attacked-this-turn.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

const T1 = "c.1.0", T2 = "c.1.1";

describe("§492 : règle pure", () => {
  it("le genre d'une attaque : mêlée, sauf lancée ou tirée ; null hors attaque", () => {
    expect(attackKindOf({ activityType: "attack", attackType: "melee" })).toBe("melee");
    expect(attackKindOf({ activityType: "attack", attackType: "melee", attackMode: "oneHanded" })).toBe("melee");
    expect(attackKindOf({ activityType: "attack", attackType: "melee", attackMode: "thrown" })).toBe("ranged");
    expect(attackKindOf({ activityType: "attack", attackType: "melee", attackMode: "thrown-offhand" })).toBe("ranged");
    expect(attackKindOf({ activityType: "attack", attackType: "ranged" })).toBe("ranged");
    expect(attackKindOf({ activityType: "save" })).toBe(null);
  });
  it("note les attaques d'un tour, chaque genre une fois, jamais contre soi", () => {
    let log = recordAttack(null, { turn: T1, source: "A", targets: ["B", "C", "A"], kind: "melee" });
    log = recordAttack(log, { turn: T1, source: "A", targets: ["B"], kind: "ranged" });
    log = recordAttack(log, { turn: T1, source: "A", targets: ["B"], kind: "melee" });
    expect(attacksDuring(log, { turn: T1, source: "A", target: "B" })).toEqual(["melee", "ranged"]);
    expect(attacksDuring(log, { turn: T1, source: "A", target: "C" })).toEqual(["melee"]);
    expect(attacksDuring(log, { turn: T1, source: "A", target: "A" })).toEqual([]);
    expect(attacksDuring(log, { turn: T1, source: "B", target: "A" })).toEqual([]);
    expect(Array.isArray(log.attacks)).toBe(true);   // une liste : setFlag la remplace entière
  });
  it("un autre tour repart de zéro, et l'ancien registre ne répond plus", () => {
    const first = recordAttack(null, { turn: T1, source: "A", targets: ["B"], kind: "melee" });
    const second = recordAttack(first, { turn: T2, source: "B", targets: ["A"], kind: "ranged" });
    expect(second.attacks).toEqual([{ source: "B", target: "A", kinds: ["ranged"] }]);
    expect(attacksDuring(first, { turn: T2, source: "A", target: "B" })).toEqual([]);
    expect(first.attacks[0].kinds).toEqual(["melee"]);   // pas modifié en place
  });
  it("rien à noter sans tour, source, cible ou genre", () => {
    expect(recordAttack(null, { turn: null, source: "A", targets: ["B"], kind: "melee" })).toBe(null);
    expect(recordAttack(null, { turn: T1, source: "A", targets: [], kind: "melee" })).toBe(null);
    expect(recordAttack(null, { turn: T1, source: "A", targets: ["B"], kind: null })).toBe(null);
  });
  it("la condition : true, false, un genre ou une liste", () => {
    expect(attackedMatches(["melee"], true)).toBe(true);
    expect(attackedMatches([], true)).toBe(false);
    expect(attackedMatches([], false)).toBe(true);
    expect(attackedMatches(["ranged"], "melee")).toBe(false);
    expect(attackedMatches(["melee", "ranged"], "melee")).toBe(true);
    expect(attackedMatches(["ranged"], ["melee", "ranged"])).toBe(true);
    expect(attackedMatches(["melee"], "spell")).toBe(false);
    expect(validAttackedArg("melee")).toBe(true);
    expect(validAttackedArg(["melee", "x"])).toBe(false);
    expect(validAttackedArg([])).toBe(false);
  });
});

describe("§492 : le fait source.attackedSelfThisTurn", () => {
  let factsFor, KNOWN_FACTS, noteAttack;
  const combat = { id: "c", started: true, round: 1, turn: 0, flags: {},
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = structuredClone(value); } };
  const actor = id => ({ id, uuid: `Actor.${id}`, items: [], effects: [], statuses: new Set() });
  const attacker = actor("attacker"), guard = actor("guard"), other = actor("other");
  const sword = { type: "attack", attack: { type: { value: "melee" } } };
  const bow = { type: "attack", attack: { type: { value: "ranged" } } };

  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.game.combat = combat;
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    await import("../module/scripts/adapter/running-water.mjs");   // même ordre de chargement que armor-facts.test.mjs (cycle facts ↔ content)
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
    ({ noteAttack } = await import("../module/scripts/adapter/attacked-this-turn.mjs"));
    KNOWN_FACTS = factsFor();
  });

  const retort = want => ({ triggers: [{ on: "enemyTurnEnd", if: { "source.attackedSelfThisTurn": want },
    do: [{ type: "use", target: "source" }] }] });

  it("est un fait connu du contenu", () => {
    expect(validateEntry(retort("melee"), { facts: KNOWN_FACTS })).toEqual([]);
    expect(validateEntry(retort(true), { facts: KNOWN_FACTS })).toEqual([]);
  });

  it("à la fin du tour de l'attaquant : vrai pour la cible attaquée au corps à corps, pas pour une autre", async () => {
    await noteAttack(attacker, [guard], sword);
    await noteAttack(attacker, [other], bow);
    // Le combat passe au tour suivant ; la fenêtre parle du tour qui vient de finir.
    combat.turn = 1;
    const ended = { source: attacker, target: guard, self: guard, turnKey: "c.1.0" };
    expect(holds({ "source.attackedSelfThisTurn": "melee" }, factsFor(ended))).toBe(true);
    expect(holds({ "source.attackedSelfThisTurn": "ranged" }, factsFor(ended))).toBe(false);
    const onOther = { ...ended, target: other, self: other };
    expect(holds({ "source.attackedSelfThisTurn": "melee" }, factsFor(onOther))).toBe(false);
    expect(holds({ "source.attackedSelfThisTurn": true }, factsFor(onOther))).toBe(true);
    // Sans le tour qui vient de finir, « ce tour » est le tour en cours : rien.
    expect(holds({ "source.attackedSelfThisTurn": true }, factsFor({ source: attacker, target: guard, self: guard }))).toBe(false);
  });

  it("le tour suivant efface le registre", async () => {
    await noteAttack(guard, [attacker], bow);   // tour c.1.1
    expect(holds({ "source.attackedSelfThisTurn": true }, factsFor({ source: attacker, self: guard, turnKey: "c.1.0" }))).toBe(false);
    expect(holds({ "source.attackedSelfThisTurn": "ranged" }, factsFor({ source: guard, self: attacker }))).toBe(true);
  });

  it("hors combat : jamais", () => {
    combat.started = false;
    expect(holds({ "source.attackedSelfThisTurn": true }, factsFor({ source: guard, self: attacker }))).toBe(false);
    combat.started = true;
  });
});
