import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MODULE_ID } from "../module/scripts/constants.mjs";

/**
 * §397: the pending launch (table pause, message under the pause icon) is lifted only when the GM's window closes.
 * A GM who reloads their page with the window open has no window left to close: on load, their launch left pending is cancelled.
 */
const routes = new Map();
vi.mock("../module/scripts/runtime/router.mjs", () => ({ route: (hook, handler) => routes.set(hook, handler) }));
vi.mock("../module/scripts/runtime/group-roll.mjs", () => ({ requestGroupRoll: vi.fn(async () => null) }));
vi.mock("../module/scripts/adapter/vision.mjs", () => ({ canSee: () => true }));
vi.mock("../module/scripts/adapter/summons.mjs", () => ({ summonItemOf: () => null }));

const { registerCombatLaunch, beginLaunch, launchApi, LAUNCH_STATE } = await import("../module/scripts/runtime/combat-launch.mjs");

const settings = new Map();
const state = () => settings.get(`${MODULE_ID}.${LAUNCH_STATE}`) ?? {};

beforeEach(() => {
  routes.clear();
  settings.clear();
  globalThis.game = {
    paused: false, user: { id: "mj", isGM: true }, users: { activeGM: { isSelf: true } }, combats: [],
    settings: { register: () => {}, get: (scope, key) => settings.get(`${scope}.${key}`), set: async (scope, key, value) => settings.set(`${scope}.${key}`, value) },
    togglePause: vi.fn(paused => { game.paused = paused; })
  };
  globalThis.canvas = { scene: { id: "S1" } };
  registerCombatLaunch();
});

afterEach(() => { delete globalThis.game; delete globalThis.canvas; });

describe("§397: a launch left pending after a reload", () => {
  it("the GM who had opened the window reloads: the launch is cancelled, the earlier pause comes back", async () => {
    expect(await beginLaunch()).toBe(true);
    expect(launchApi.pending()).toBe(true);
    expect(game.paused).toBe(true);
    // The reload: the window no longer exists, `ready` fires again.
    await routes.get("ready")?.();
    expect(launchApi.pending()).toBe(false);
    expect(game.paused).toBe(false);
  });

  it("the game was already paused before: it stays so", async () => {
    game.paused = true;
    await beginLaunch();
    game.togglePause.mockClear();
    await routes.get("ready")?.();
    expect(launchApi.pending()).toBe(false);
    expect(game.togglePause).not.toHaveBeenCalled();
  });

  it("another GM's launch, whose window may still be open, is not touched", async () => {
    await beginLaunch();
    game.user = { id: "second", isGM: true };
    await routes.get("ready")?.();
    expect(launchApi.pending()).toBe(true);
    expect(state().by).toBe("mj");
  });

  it("rien en attente : rien ne change", async () => {
    await routes.get("ready")?.();
    expect(game.togglePause).not.toHaveBeenCalled();
    expect(state().pending).toBeFalsy();
  });
});
