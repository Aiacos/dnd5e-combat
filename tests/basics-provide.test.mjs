import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §15.2 : le MJ actif pose sur un personnage les actions de base qui lui manquent — une fois. Deux passages qui se chevauchent pour
 * le même acteur (deux tokens d'un même personnage qui rejoignent le combat, le début du combat pendant qu'un combattant s'ajoute)
 * lisaient tous deux « manquantes » avant que la première création ne revienne du serveur.
 */
const routes = new Map();
vi.mock("../module/scripts/runtime/router.mjs", () => ({ route: (hook, handler) => routes.set(hook, handler) }));
vi.mock("../module/scripts/adapter/basics.mjs", () => ({
  basicActionData: kind => ({ name: kind }),
  missingBasicActions: actor => ["dash", "dodge"].filter(kind => !actor.items.includes(kind))
}));
vi.mock("../module/scripts/adapter/familiar.mjs", () => ({ isFamiliarActor: () => false, isFamiliarToken: () => false }));
vi.mock("../module/scripts/adapter/conditions.mjs", () => ({ rangedFeatsOf: () => ({}) }));

const { registerBasics } = await import("../module/scripts/runtime/basics.mjs");

beforeEach(() => {
  routes.clear();
  globalThis.game = { settings: { register: () => {}, get: () => true } };
  registerBasics();
});
afterEach(() => { delete globalThis.game; });

/** Un personnage dont les items créés n'apparaissent qu'à la réponse du serveur. */
function character(name, items=[]) {
  const actor = { name, uuid: `Actor.${name}`, type: "character", items: [...items], created: [] };
  actor.createEmbeddedDocuments = async (type, data) => {
    actor.created.push(data.map(d => d.name));
    await new Promise(resolve => setTimeout(resolve, 5));
    actor.items.push(...data.map(d => d.name));
  };
  return actor;
}

describe("§15.2 : actions de base posées une seule fois", () => {
  it("deux combattants du même personnage ajoutés ensemble : une seule création", async () => {
    const actor = character("Lia");
    await Promise.all([routes.get("createCombatant")({ actor }), routes.get("createCombatant")({ actor })]);
    expect(actor.created).toEqual([["dash", "dodge"]]);
  });

  it("le début du combat pendant qu'un combattant s'ajoute : une seule création par personnage", async () => {
    const lia = character("Lia");
    const tom = character("Tom", ["dash"]);
    await Promise.all([
      routes.get("createCombatant")({ actor: lia }),
      routes.get("combatStart")({ combatants: [{ actor: lia }, { actor: tom }] })
    ]);
    expect(lia.created).toEqual([["dash", "dodge"]]);
    expect(tom.created).toEqual([["dodge"]]);
  });

  it("une création refusée n'empêche pas le passage suivant", async () => {
    const actor = character("Lia");
    const create = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = async () => { throw new Error("refusé"); };
    await expect(routes.get("createCombatant")({ actor })).rejects.toThrow("refusé");
    actor.createEmbeddedDocuments = create;
    await routes.get("createCombatant")({ actor });
    expect(actor.created).toEqual([["dash", "dodge"]]);
  });
});
