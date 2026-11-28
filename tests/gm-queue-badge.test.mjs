import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 2026-11-28 (user's report: the « GM queue » tool showed a red « 1 » while the queue was empty). Two causes, both fixed:
 *  - the badge recomputed the queue at each toolbar render without moving the snapshot the next change is compared with: a line that
 *    came and went between two announcements left the badge lit for good;
 *  - chat messages carry two parts of the queue (requested rolls, rolls due by an absent author), but only a resolution change refreshed
 *    it: a requested roll's last result, or a message deleted, left the badge as it was.
 */
const routes = new Map();
vi.mock("../module/scripts/runtime/router.mjs", () => ({
  route: (hook, handler) => routes.set(hook, [...(routes.get(hook) ?? []), handler])
}));
const state = { blocked: [], awaiting: [] };
vi.mock("../module/scripts/adapter/awaiting.mjs", () => ({
  AWAITING_HOOK: "test.awaiting", awaitingList: () => state.awaiting, awaitingLabels: () => ({})
}));
vi.mock("../module/scripts/adapter/player-wait.mjs", () => ({
  FORCE_WINDOWS_QUERY: "test.force", PLAYER_WAITS_HOOK: "test.waits", forcePlayerWait: vi.fn(), playerWaits: () => []
}));
vi.mock("../module/scripts/adapter/dialogs.mjs", () => ({
  combatWindowSeconds: () => 10, windowsUnlimited: () => false, PROMPTS_HOOK: "test.prompts", localPrompts: () => [], answerPrompt: vi.fn()
}));
vi.mock("../module/scripts/adapter/group-roll.mjs", () => ({ requestOf: () => null, viewOf: () => null, testTitle: () => "" }));
vi.mock("../module/scripts/runtime/group-roll.mjs", () => ({ forceGroupRoll: vi.fn() }));
vi.mock("../module/scripts/runtime/engine.mjs", () => ({ blockedRolls: () => state.blocked, rollForAbsent: vi.fn() }));
vi.mock("../module/scripts/runtime/shared.mjs", () => ({ log: () => {}, notice: () => {}, tokenOfActor: () => null, isExecutor: () => true }));

const { registerGmQueue, refreshQueue, GM_QUEUE_HOOK } = await import("../module/scripts/runtime/gm-queue.mjs");

const announced = [];
const fire = (hook, ...args) => { for ( const handler of routes.get(hook) ?? [] ) handler(...args); };
const settle = () => new Promise(r => setTimeout(r, 150));
const stuck = { messageId: "m1", userId: "u1", userName: "Bramo", actor: null, actorName: "Bramo", item: "Longsword", heal: false };

beforeEach(() => {
  routes.clear();
  announced.length = 0;
  state.blocked = [];
  state.awaiting = [];
  globalThis.game = { user: { isGM: true, id: "gm" }, users: [], messages: { contents: [] } };
  globalThis.Hooks = { callAll: (hook, q) => { if ( hook === GM_QUEUE_HOOK ) announced.push(q.count); } };
  registerGmQueue();
  refreshQueue();   // in step with an empty queue
  announced.length = 0;
});
afterEach(() => { delete globalThis.game; delete globalThis.Hooks; });

describe("GM queue — the badge never outlives its line", () => {
  it("a line read by a toolbar render, then gone: the change is announced (the badge goes out)", () => {
    state.blocked = [stuck];
    expect(refreshQueue().count).toBe(1);   // the toolbar render reads the queue
    state.blocked = [];
    fire("test.awaiting");                  // any later change
    expect(announced).toEqual([1, 0]);
  });

  it("a chat message deleted takes its line away, and says so", async () => {
    state.blocked = [stuck];
    fire("createChatMessage", {});
    await settle();
    state.blocked = [];
    fire("deleteChatMessage", {});
    await settle();
    expect(announced).toEqual([1, 0]);
  });

  it("any message update refreshes (a requested roll's card getting its last result), not only a resolution", async () => {
    state.blocked = [stuck];
    refreshQueue();
    state.blocked = [];
    fire("updateChatMessage", {}, { system: { targets: [] } });
    await settle();
    expect(announced.at(-1)).toBe(0);
  });

  it("a burst of messages makes one refresh", async () => {
    state.blocked = [stuck];
    for ( let n = 0; n < 5; n++ ) fire("createChatMessage", {});
    await settle();
    expect(announced).toEqual([1]);
  });

  it("at a player: nothing announced, an empty queue", () => {
    game.user.isGM = false;
    state.blocked = [stuck];
    expect(refreshQueue().count).toBe(0);
    expect(announced).toEqual([]);
  });
});
