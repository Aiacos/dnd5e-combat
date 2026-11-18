import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Le tour d'une créature commence ou finit : chacun des effets qu'elle porte joue ses étapes (sauvegarde rejouée, dégâts, fin de
 * l'effet). Un effet dont une étape échoue (document déjà supprimé, jet refusé) ne prive pas les autres effets de leur tour.
 */
const routes = new Map();
const inflict = vi.fn(async () => null);
vi.mock("../module/scripts/runtime/router.mjs", () => ({ route: (hook, handler) => routes.set(hook, handler) }));
vi.mock("../module/scripts/adapter/retaliation.mjs", () => ({ inflict: (...args) => inflict(...args) }));
vi.mock("../module/scripts/adapter/areas.mjs", () => ({ resaveAgainst: vi.fn(async () => null) }));
vi.mock("../module/scripts/adapter/plane.mjs", () => ({ samePlane: () => true }));
vi.mock("../module/scripts/adapter/death.mjs", () => ({ isDeadActor: () => false }));
vi.mock("../module/scripts/adapter/triggers.mjs", () => ({
  declarationsOf: () => [], declarationsOfEffects: actor => actor.declarations ?? [], factsFor: () => ({}), tokenOf: () => null,
  consumedMarks: () => [], bonusTurnKey: () => null, bonusSpent: () => false, bonusKeyOf: () => null
}));

const { registerTriggers } = await import("../module/scripts/runtime/triggers.mjs");

const documents = new Map();
let errors;

beforeEach(() => {
  routes.clear();
  documents.clear();
  inflict.mockReset();
  inflict.mockResolvedValue(null);
  globalThis.Hooks = { callAll: () => {} };
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  globalThis.ChatMessage = { implementation: { getSpeaker: () => ({}) } };
  globalThis.game = { i18n: { localize: key => key, format: key => key }, settings: { get: () => false } };
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  registerTriggers();
});

afterEach(() => {
  errors.mockRestore();
  delete globalThis.Hooks; delete globalThis.fromUuid; delete globalThis.ChatMessage; delete globalThis.game;
});

/** Un effet porté qui inflige ses dégâts à son porteur au début de son tour (`on`), posé par `item`. */
function bearerDamage(name, { on="startOfTurn", remove=false }={}) {
  const effect = { uuid: `effect-${name}`, getFlag: () => null, delete: vi.fn(async () => {}) };
  documents.set(effect.uuid, effect);
  documents.set(`item-${name}`, { uuid: `item-${name}`, name, actor: { uuid: "lanceur" } });
  const steps = [{ type: "damage", to: "bearer", formula: "1d4", damageType: "acid" }];
  if ( remove ) steps.push({ type: "remove" });
  return { name, identifier: name, on: [on], do: steps, effect: effect.uuid, item: `item-${name}` };
}

/** Un combat à deux : la créature qui porte les effets, et le lanceur qui les a posés. */
function fight(declarations) {
  const scene = { tokens: [] };
  const combatant = (id, actor) => {
    const token = { uuid: `token-${id}`, name: id, actor, parent: scene };
    scene.tokens.push(token);
    return { id, actor, token };
  };
  const bearer = combatant("porteur", { uuid: "porteur", name: "porteur", declarations, effects: { size: declarations.length } });
  const caster = combatant("lanceur", { uuid: "lanceur", name: "lanceur", declarations: [], effects: { size: 0 } });
  const list = [bearer, caster];
  return { combatants: { get: id => list.find(c => c.id === id) }, scene };
}

const turn = (index, combatantId) => ({ round: 1, turn: index, combatantId });
const failOn = name => inflict.mockImplementation(async ({ flags }) => {
  if ( flags.bearerDamage.item === name ) throw new Error("jet refusé");
  return null;
});
const inflicted = () => inflict.mock.calls.map(([{ flags }]) => flags.bearerDamage.item);

describe("tour d'une créature : un effet qui échoue n'arrête pas les autres", () => {
  it("début de tour, trois effets, le deuxième échoue : le premier et le troisième infligent leurs dégâts", async () => {
    const combat = fight([bearerDamage("epine"), bearerDamage("fleche-acide"), bearerDamage("cauchemar")]);
    failOn("fleche-acide");
    await routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"));
    await vi.waitFor(() => expect(inflicted()).toEqual(["epine", "fleche-acide", "cauchemar"]));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("fleche-acide");
  });

  it("fin de tour : un effet qui ne se supprime pas (déjà parti) laisse les suivants finir", async () => {
    const gone = bearerDamage("premier", { on: "endOfTurn", remove: true });
    const next = bearerDamage("second", { on: "endOfTurn", remove: true });
    documents.get(gone.effect).delete.mockRejectedValue(new Error("effet introuvable"));
    const combat = fight([gone, next]);
    await routes.get("combatTurnChange")(combat, turn(0, "porteur"), turn(1, "lanceur"));
    await vi.waitFor(() => expect(documents.get(next.effect).delete).toHaveBeenCalledTimes(1));
    expect(inflicted()).toEqual(["premier", "second"]);
  });

  it("début du tour du lanceur : les dégâts de ses effets sur une autre créature, un par effet, malgré un échec", async () => {
    const on = "originTurnStart";
    const combat = fight([bearerDamage("submersion", { on }), bearerDamage("tourbillon", { on })]);
    failOn("submersion");
    await routes.get("combatTurnChange")(combat, turn(0, "porteur"), turn(1, "lanceur"));
    await vi.waitFor(() => expect(inflicted()).toEqual(["submersion", "tourbillon"]));
  });
});
