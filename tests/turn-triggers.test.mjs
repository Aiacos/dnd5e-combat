import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Le tour d'une créature commence ou finit : chacun des effets qu'elle porte joue ses étapes (sauvegarde rejouée, dégâts, fin de
 * l'effet). Un effet dont une étape échoue (document déjà supprimé, jet refusé) ne prive pas les autres effets de leur tour ; une
 * tâche de tour qui échoue en entier revient au routeur, qui la consigne sous son libellé.
 */
const routes = new Map();
const inflict = vi.fn(async () => null);
vi.mock("../module/scripts/runtime/router.mjs", () => ({ route: (hook, handler) => routes.set(hook, handler) }));
vi.mock("../module/scripts/adapter/retaliation.mjs", () => ({ inflict: (...args) => inflict(...args) }));
vi.mock("../module/scripts/adapter/areas.mjs", () => ({ resaveAgainst: vi.fn(async () => null) }));
vi.mock("../module/scripts/adapter/plane.mjs", () => ({ samePlane: () => true }));
vi.mock("../module/scripts/adapter/death.mjs", () => ({ isDeadActor: () => false }));
vi.mock("../module/scripts/adapter/triggers.mjs", () => ({
  declarationsOf: actor => actor.own ?? [], declarationsOfEffects: actor => actor.declarations ?? [], factsFor: context => { contexts.push(context); return {}; },
  tokenOf: () => null, consumedMarks: () => [], bonusTurnKey: () => null, bonusSpent: () => false, bonusKeyOf: () => null,
  declaredRollDisadvantage: actor => actor.disadvantaged ?? [],
  declaredRollAdvantage: actor => actor.favoured ?? []
}));
const contexts = [];

const { registerTriggers } = await import("../module/scripts/runtime/triggers.mjs");

const documents = new Map();
let errors;

beforeEach(() => {
  routes.clear();
  documents.clear();
  contexts.length = 0;
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

describe("tour d'une créature : une tâche qui échoue revient au routeur", () => {
  /** Une créature dont la lecture des déclarations échoue : la tâche de son tour échoue avant toute déclaration. */
  const unreadable = combat => Object.defineProperty(combat.combatants.get("porteur").actor, "declarations", {
    get() { throw new Error("déclarations illisibles"); }
  });

  it("début de tour : la promesse rendue à l'inscription porte l'erreur", async () => {
    const combat = fight([]);
    unreadable(combat);
    await expect(routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"))).rejects.toThrow("déclarations illisibles");
  });

  it("début du tour du lanceur, effets posés sur une autre créature : de même", async () => {
    const combat = fight([]);
    combat.combatants.get("porteur").actor.effects.size = 1;
    unreadable(combat);
    await expect(routes.get("combatTurnChange")(combat, turn(0, "porteur"), turn(1, "lanceur"))).rejects.toThrow("déclarations illisibles");
  });

  it("tout se passe bien : la promesse se résout une fois les tâches finies", async () => {
    const combat = fight([bearerDamage("epine")]);
    await routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"));
    expect(inflicted()).toEqual(["epine"]);
  });
});

/* -------------------------------------------- */

describe("§484 : un trait inflige ses dégâts à son porteur (sans effet posé)", () => {
  /** Un trait de la créature : `to: "self"`, porté par l'item lui-même (`via: null`). */
  function selfDamage(name) {
    documents.set(`item-${name}`, { uuid: `item-${name}`, name, system: { activities: new Map() } });
    return { name, identifier: name, on: ["startOfTurn"], via: null, if: null,
      do: [{ type: "damage", to: "self", formula: "20", damageType: "radiant" }], item: `item-${name}` };
  }
  it("début de tour : la créature subit les dégâts de son trait, et les faits la connaissent comme `self`", async () => {
    const combat = fight([]);
    const bearer = combat.combatants.get("porteur");
    bearer.actor.own = [selfDamage("brule-au-soleil")];
    await routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"));
    await vi.waitFor(() => expect(inflict).toHaveBeenCalledTimes(1));
    const [{ step, targetUuid, flags }] = inflict.mock.calls[0];
    expect(step).toMatchObject({ to: "self", formula: "20", damageType: "radiant" });
    expect(targetUuid).toBe("token-porteur");
    expect(flags.selfDamage).toEqual({ item: "brule-au-soleil", moment: "startOfTurn" });
    expect(contexts.some(c => (c.self === bearer.actor) && (c.selfToken === bearer.token))).toBe(true);
  });
});

describe("§484 : Désavantage déclaré aux tests et aux sauvegardes", () => {
  const rollOf = (hook, actor) => {
    const config = { subject: { documentName: "Actor", name: "créature", ...actor }, ability: "dex", rolls: [{ options: {} }] };
    routes.get(hook)(config);
    return config.rolls[0].options;
  };
  it("un trait qui le déclare : Désavantage ; sinon rien", () => {
    expect(rollOf("dnd5e.preRollAbilityCheckV2", { disadvantaged: ["Brûle au soleil"] }).disadvantage).toBe(true);
    expect(rollOf("dnd5e.preRollAbilityCheckV2", {}).disadvantage).toBeUndefined();
    expect(rollOf("dnd5e.preRollSavingThrowV2", { disadvantaged: ["Brûle au soleil"] }).disadvantage).toBe(true);
  });
  it("a trait declaring Advantage (rollAdvantage): Advantage; both together: both, dnd5e combines them", () => {
    const save = rollOf("dnd5e.preRollSavingThrowV2", { favoured: ["Frenzy"] });
    expect(save.advantage).toBe(true);
    expect(save.disadvantage).toBeUndefined();
    expect(rollOf("dnd5e.preRollAbilityCheckV2", { favoured: ["Frenzy"] }).advantage).toBe(true);
    const both = rollOf("dnd5e.preRollSavingThrowV2", { favoured: ["Frenzy"], disadvantaged: ["Sunlight Sensitivity"] });
    expect(both).toMatchObject({ advantage: true, disadvantage: true });
    expect(rollOf("dnd5e.preRollSavingThrowV2", {}).advantage).toBeUndefined();
  });
});
