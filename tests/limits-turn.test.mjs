import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * "Once per turn" (§16.40 `usageLimits.oncePerTurn`, §16.46 `damageShield.oncePerTurn`): the mark placed on the actor or
 * the effect carried only `round-turn`, never cleared. In a later combat, at the same round and the same rank, the activity was
 * judged already used. The key now carries the combat id (`currentTurnKey` of adapter/turn.mjs).
 */
vi.mock("../module/scripts/adapter/content.mjs", async importOriginal => ({
  ...(await importOriginal()),
  contentOf: item => ({ entry: item?.rule ?? null }),
  identifierOf: item => ({ id: item?.identifier ?? null })
}));
const { usageLimitProblems, markUsedThisTurn } = await import("../module/scripts/adapter/limits.mjs");
const { applyDamageShields } = await import("../module/scripts/adapter/defenses.mjs");

/** A document that keeps its flags: getFlag / setFlag. */
function withFlags(doc) {
  const flags = {};
  return Object.assign(doc, {
    getFlag: (scope, key) => flags[`${scope}.${key}`],
    setFlag: async (scope, key, value) => { flags[`${scope}.${key}`] = value; }
  });
}

const combat = id => ({ id, started: true, round: 1, turn: 0, getCombatantsByActor: () => [] });

afterEach(() => { delete globalThis.game; delete globalThis.Roll; });

describe("\"once per turn\" does not carry over from one combat to another", () => {
  it("usageLimits: the mark of a previous combat, same round and same rank, does not block", async () => {
    const actor = withFlags({ isOwner: true, items: [] });
    const item = { rule: { usageLimits: { act1: { oncePerTurn: true } } } };
    const activity = { id: "act1", item, actor };
    const used = () => usageLimitProblems(activity, { inCombat: true, ownTurn: true }).issues.length > 0;

    globalThis.game = { combat: combat("combatAAAAAAAAAA") };
    expect(used()).toBe(false);
    await expect(markUsedThisTurn(activity)).resolves.toBe(true);
    expect(used()).toBe(true);

    globalThis.game = { combat: combat("combatBBBBBBBBBB") };
    expect(used()).toBe(false);
  });

  it("damageShield: the mark on the effect from a previous combat does not stop it from protecting", async () => {
    globalThis.Roll = class { constructor() {} async evaluate() { this.total = 3; return this; } };
    const item = { rule: { damageShield: { worn: "fire", formula: "1d4", oncePerTurn: true } }, system: { equipped: true } };
    const shield = withFlags(Object.assign(item, { name: "Bouclier" }));
    const actor = { items: [shield], effects: [] };
    const hit = () => applyDamageShields(actor, [{ type: "fire", value: 10 }]);

    globalThis.game = { combat: combat("combatAAAAAAAAAA") };
    expect((await hit()).done).toHaveLength(1);
    expect((await hit()).done).toHaveLength(0);      // same turn: already served

    globalThis.game = { combat: combat("combatBBBBBBBBBB") };
    expect((await hit()).done).toHaveLength(1);
  });
});
