import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §17.3: Frightened — no voluntary step that brings it closer to the source of fear, whatever the way of moving. A movement
 * made in one piece (drag, keyboard) arrives at `preMoveToken` with its whole path in `passed` and nothing in `pending` (§225).
 */
const source = { name: "Dragon", x: 0 };
vi.mock("../module/scripts/adapter/barriers.mjs", () => ({ barrierCrossed: () => null }));
vi.mock("../module/scripts/adapter/plane.mjs", () => ({ isEthereal: () => false, etherealWallBetween: () => false }));
vi.mock("../module/scripts/adapter/turn.mjs", () => ({
  combatantFor: () => null, readBudget: () => ({}), writeBudget: async () => {}, positionOf: w => ({ x: w.x }),
  distanceBetween: (token, other, { posA }={}) => ({ value: Math.abs((posA ?? token._source).x - other.x) })
}));
vi.mock("../module/scripts/adapter/pilot.mjs", () => ({ pilotOf: () => null, summonerToken: () => null, groupTokens: () => [] }));
vi.mock("../module/scripts/adapter/units.mjs", () => ({ lengthIn: n => n }));
vi.mock("../module/scripts/adapter/movement.mjs", () => ({ continuedFlags: () => null, walkOptions: () => ({}) }));
vi.mock("../module/scripts/adapter/conditions.mjs", () => ({ fearSources: () => [source], leashesOf: () => [] }));
vi.mock("../module/scripts/adapter/windward.mjs", () => ({ windwardCost: () => 0 }));
vi.mock("../module/scripts/runtime/reactions.mjs", () => ({
  opportunityThreats: () => [], resolveOpportunity: async () => true, splitForReady: () => null
}));
vi.mock("../module/scripts/runtime/scatter.mjs", () => ({ scatterStop: () => true }));
vi.mock("../module/scripts/runtime/levels.mjs", () => ({ levelAtLeast: () => true }));
vi.mock("../module/scripts/runtime/shared.mjs", () => ({ loc: key => key, log: () => {} }));
vi.mock("../module/scripts/runtime/turn.mjs", () => ({ askAnyway: async () => false }));
vi.mock("../module/scripts/runtime/actions.mjs", () => ({
  isGrappled: () => false, movementCap: () => 30, occupiedAt: () => false, pilotMove: () => ({})
}));

const { moveIssues } = await import("../module/scripts/runtime/move-gate.mjs");

beforeEach(() => {
  globalThis.game = { user: { isGM: false } };
  globalThis.CONFIG = { Token: { movement: { actions: { walk: {}, blink: { teleport: true }, displace: {} } } } };
});
afterEach(() => { delete globalThis.game; delete globalThis.CONFIG; });

/** A Frightened token 30 from the source, and a path: `passed` (what departs in one piece), `pending` (the rest). */
const token = (statuses=["frightened"]) => ({ name: "Héros", _source: { x: 30 }, actor: { statuses: new Set(statuses) } });
const step = (x, action="walk") => ({ x, action });
const movement = (passed, pending=[]) => ({
  passed: { waypoints: passed, cost: 0 }, pending: { waypoints: pending, cost: 0 }, history: { cost: 0 },
  destination: passed.at(-1) ?? pending.at(-1), origin: { x: 30 }
});
const keys = issues => issues.map(i => i.key);

describe("§17.3: Frightened, the whole path counts", () => {
  it("dragging toward the source (everything in `passed`): held back", () => {
    expect(keys(moveIssues(token(), movement([step(25), step(20)])))).toEqual(["frightened"]);
  });

  it("the rest of a cut path (`pending`): held back too", () => {
    expect(keys(moveIssues(token(), movement([step(35)], [step(20)])))).toEqual(["frightened"]);
  });

  it("moving away: free", () => {
    expect(moveIssues(token(), movement([step(35), step(40)]))).toEqual([]);
  });

  it("teleportation or forced movement toward the source: not a voluntary step", () => {
    expect(moveIssues(token(), movement([step(20, "blink")]))).toEqual([]);
    expect(moveIssues(token(), movement([step(20, "displace")]))).toEqual([]);
  });

  it("without the Frightened condition: free", () => {
    expect(moveIssues(token([]), movement([step(20)]))).toEqual([]);
  });

  it("le MJ n'est jamais retenu", () => {
    game.user.isGM = true;
    expect(moveIssues(token(), movement([step(20)]))).toEqual([]);
  });
});
