import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A creature's turn starts or ends: each of the effects it carries plays its steps (save replayed, damage, end of the
 * effect). An effect with a failing step (document already deleted, roll refused) does not deprive the other effects of their turn;
 * a turn task that fails entirely goes back to the router, which logs it under its label.
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

/** A carried effect that deals its damage to its bearer at the start of its turn (`on`), placed by `item`. */
function bearerDamage(name, { on="startOfTurn", remove=false }={}) {
  const effect = { uuid: `effect-${name}`, getFlag: () => null, delete: vi.fn(async () => {}) };
  documents.set(effect.uuid, effect);
  documents.set(`item-${name}`, { uuid: `item-${name}`, name, actor: { uuid: "lanceur" } });
  const steps = [{ type: "damage", to: "bearer", formula: "1d4", damageType: "acid" }];
  if ( remove ) steps.push({ type: "remove" });
  return { name, identifier: name, on: [on], do: steps, effect: effect.uuid, item: `item-${name}` };
}

/** A two-creature combat: the creature that carries the effects, and the caster that placed them. */
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

describe("a creature's turn: an effect that fails does not stop the others", () => {
  it("start of turn, three effects, the second fails: the first and the third deal their damage", async () => {
    const combat = fight([bearerDamage("epine"), bearerDamage("fleche-acide"), bearerDamage("cauchemar")]);
    failOn("fleche-acide");
    await routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"));
    await vi.waitFor(() => expect(inflicted()).toEqual(["epine", "fleche-acide", "cauchemar"]));
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0][0])).toContain("fleche-acide");
  });

  it("end of turn: an effect that cannot be deleted (already gone) lets the following ones finish", async () => {
    const gone = bearerDamage("premier", { on: "endOfTurn", remove: true });
    const next = bearerDamage("second", { on: "endOfTurn", remove: true });
    documents.get(gone.effect).delete.mockRejectedValue(new Error("effet introuvable"));
    const combat = fight([gone, next]);
    await routes.get("combatTurnChange")(combat, turn(0, "porteur"), turn(1, "lanceur"));
    await vi.waitFor(() => expect(documents.get(next.effect).delete).toHaveBeenCalledTimes(1));
    expect(inflicted()).toEqual(["premier", "second"]);
  });

  it("start of the caster's turn: the damage of its effects on another creature, one per effect, despite a failure", async () => {
    const on = "originTurnStart";
    const combat = fight([bearerDamage("submersion", { on }), bearerDamage("tourbillon", { on })]);
    failOn("submersion");
    await routes.get("combatTurnChange")(combat, turn(0, "porteur"), turn(1, "lanceur"));
    await vi.waitFor(() => expect(inflicted()).toEqual(["submersion", "tourbillon"]));
  });
});

describe("a creature's turn: a task that fails goes back to the router", () => {
  /** A creature whose declarations fail to read: its turn task fails before any declaration. */
  const unreadable = combat => Object.defineProperty(combat.combatants.get("porteur").actor, "declarations", {
    get() { throw new Error("déclarations illisibles"); }
  });

  it("start of turn: the promise returned at registration carries the error", async () => {
    const combat = fight([]);
    unreadable(combat);
    await expect(routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"))).rejects.toThrow("déclarations illisibles");
  });

  it("start of the caster's turn, effects placed on another creature: likewise", async () => {
    const combat = fight([]);
    combat.combatants.get("porteur").actor.effects.size = 1;
    unreadable(combat);
    await expect(routes.get("combatTurnChange")(combat, turn(0, "porteur"), turn(1, "lanceur"))).rejects.toThrow("déclarations illisibles");
  });

  it("all goes well: the promise resolves once the tasks are done", async () => {
    const combat = fight([bearerDamage("epine")]);
    await routes.get("combatTurnChange")(combat, turn(0, "lanceur"), turn(1, "porteur"));
    expect(inflicted()).toEqual(["epine"]);
  });
});

/* -------------------------------------------- */

describe("§484: a trait deals its damage to its bearer (without a placed effect)", () => {
  /** A creature trait: `to: "self"`, carried by the item itself (`via: null`). */
  function selfDamage(name) {
    documents.set(`item-${name}`, { uuid: `item-${name}`, name, system: { activities: new Map() } });
    return { name, identifier: name, on: ["startOfTurn"], via: null, if: null,
      do: [{ type: "damage", to: "self", formula: "20", damageType: "radiant" }], item: `item-${name}` };
  }
  it("start of turn: the creature takes its trait's damage, and the facts know it as `self`", async () => {
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

describe("§484: Disadvantage declared on checks and saves", () => {
  const rollOf = (hook, actor) => {
    const config = { subject: { documentName: "Actor", name: "créature", ...actor }, ability: "dex", rolls: [{ options: {} }] };
    routes.get(hook)(config);
    return config.rolls[0].options;
  };
  it("a trait that declares it: Disadvantage; otherwise nothing", () => {
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
