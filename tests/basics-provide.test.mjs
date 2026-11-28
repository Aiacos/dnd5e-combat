import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §15.2: the active GM gives a character the basic actions it lacks — once. Two overlapping passes for the same actor (two
 * tokens of the same character joining combat, the start of combat while a combatant is being added) both read "missing"
 * before the first creation came back from the server.
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

/** A character whose created items appear only when the server responds. */
function character(name, items=[]) {
  const actor = { name, uuid: `Actor.${name}`, type: "character", items: [...items], created: [] };
  actor.createEmbeddedDocuments = async (type, data) => {
    actor.created.push(data.map(d => d.name));
    await new Promise(resolve => setTimeout(resolve, 5));
    actor.items.push(...data.map(d => d.name));
  };
  return actor;
}

describe("§15.2: basic actions provided only once", () => {
  it("two combatants of the same character added together: a single creation", async () => {
    const actor = character("Lia");
    await Promise.all([routes.get("createCombatant")({ actor }), routes.get("createCombatant")({ actor })]);
    expect(actor.created).toEqual([["dash", "dodge"]]);
  });

  it("the start of combat while a combatant is being added: a single creation per character", async () => {
    const lia = character("Lia");
    const tom = character("Tom", ["dash"]);
    await Promise.all([
      routes.get("createCombatant")({ actor: lia }),
      routes.get("combatStart")({ combatants: [{ actor: lia }, { actor: tom }] })
    ]);
    expect(lia.created).toEqual([["dash", "dodge"]]);
    expect(tom.created).toEqual([["dodge"]]);
  });

  it("a refused creation does not prevent the next pass", async () => {
    const actor = character("Lia");
    const create = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = async () => { throw new Error("refusé"); };
    await expect(routes.get("createCombatant")({ actor })).rejects.toThrow("refusé");
    actor.createEmbeddedDocuments = create;
    await routes.get("createCombatant")({ actor });
    expect(actor.created).toEqual([["dash", "dodge"]]);
  });
});
