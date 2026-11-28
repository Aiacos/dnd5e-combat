import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { skipTarget } from "../module/scripts/core/skip-defeated.mjs";

// 2026-11-28 (user's request): the turn passes defeated NPCs.
describe("skipTarget", () => {
  const t = (...skips) => skips.map(skip => ({ skip }));

  it("a turn that is not skipped stays", () => {
    expect(skipTarget(t(false, true, false), { round: 1, turn: 0 })).toBeNull();
  });

  it("a defeated NPC passes to the next creature", () => {
    expect(skipTarget(t(false, true, false), { round: 1, turn: 1 })).toEqual({ round: 1, turn: 2 });
  });

  it("several defeated in a row are all passed", () => {
    expect(skipTarget(t(false, true, true, true, false), { round: 2, turn: 1 })).toEqual({ round: 2, turn: 4 });
  });

  it("past the last turn: next round, from the top", () => {
    expect(skipTarget(t(false, false, true, true), { round: 3, turn: 2 })).toEqual({ round: 4, turn: 0 });
  });

  it("everyone defeated: the turn stays (no endless loop)", () => {
    expect(skipTarget(t(true, true), { round: 1, turn: 0 })).toBeNull();
  });

  it("odd input: nothing", () => {
    expect(skipTarget([], { round: 1, turn: 0 })).toBeNull();
    expect(skipTarget(t(true), { round: 1, turn: 5 })).toBeNull();
    expect(skipTarget(null, null)).toBeNull();
  });
});

const routes = new Map();
vi.mock("../module/scripts/runtime/router.mjs", () => ({
  route: (hook, handler) => routes.set(hook, [...(routes.get(hook) ?? []), handler])
}));
const notices = [];
vi.mock("../module/scripts/runtime/shared.mjs", () => ({ log: () => {}, notice: (...args) => notices.push(args) }));
vi.mock("../module/scripts/runtime/combat-events.mjs", () => ({ isEvent: c => !!c.event }));

const { registerSkipDefeated, SKIP_DEFEATED } = await import("../module/scripts/runtime/skip-defeated.mjs");

describe("on the active GM, at a turn change", () => {
  const settings = new Map();
  const registered = new Map();
  const combatant = (name, { type="npc", hp=7, dead=false, defeated=false, event=false }={}) => ({
    name, defeated, event, token: { uuid: `Token.${name}`, hidden: false },
    actor: { type, statuses: new Set(dead ? ["dead"] : []), system: { attributes: { hp: { value: hp } } } }
  });
  let combat;
  const fire = async (prior, current) => { for ( const h of routes.get("combatTurnChange") ?? [] ) await h(combat, prior, current); };

  beforeEach(() => {
    routes.clear();
    notices.length = 0;
    globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" } };
    globalThis.game = { settings: {
      register: (scope, key, data) => { registered.set(key, data); settings.set(key, data.default); },
      get: (scope, key) => settings.get(key)
    } };
    combat = { started: true, updates: [], async update(data) { this.updates.push(data); },
      turns: [combatant("Hero", { type: "character" }), combatant("Goblin A", { hp: 0 }), combatant("Goblin B", { dead: true }),
        combatant("Ogre")] };
    registerSkipDefeated();
  });
  afterEach(() => { delete globalThis.game; delete globalThis.CONFIG; });

  it("is a world setting, shown, on by default", () => {
    expect(registered.get(SKIP_DEFEATED)).toMatchObject({ scope: "world", config: true, type: Boolean, default: true });
  });

  it("an NPC at 0 HP and a dead one are passed; the table is told", async () => {
    await fire({ round: 1, turn: 0 }, { round: 1, turn: 1 });
    expect(combat.updates).toEqual([{ round: 1, turn: 3 }]);
    expect(notices[0][0].uuid).toBe("Token.Goblin A");
    expect(notices[0][3]).toMatchObject({ all: true });
  });

  it("a player character at 0 HP keeps its turn (death saving throws)", async () => {
    combat.turns[0] = combatant("Hero", { type: "character", hp: 0 });
    await fire({ round: 1, turn: 3 }, { round: 2, turn: 0 });
    expect(combat.updates).toEqual([]);
  });

  it("an initiative event keeps its turn", async () => {
    combat.turns[1] = combatant("Trap", { event: true, hp: 0 });
    await fire({ round: 1, turn: 0 }, { round: 1, turn: 1 });
    expect(combat.updates).toEqual([]);
  });

  it("going back never skips", async () => {
    await fire({ round: 1, turn: 3 }, { round: 1, turn: 2 });
    expect(combat.updates).toEqual([]);
  });

  it("setting off: nothing", async () => {
    settings.set(SKIP_DEFEATED, false);
    await fire({ round: 1, turn: 0 }, { round: 1, turn: 1 });
    expect(combat.updates).toEqual([]);
  });

  it("a hidden NPC's skip is shown to the GM only", async () => {
    combat.turns[1].token.hidden = true;
    await fire({ round: 1, turn: 0 }, { round: 1, turn: 1 });
    expect(notices[0][3]).toMatchObject({ all: true, gmOnly: true });
  });
});
