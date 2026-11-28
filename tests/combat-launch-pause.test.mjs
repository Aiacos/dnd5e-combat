import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MODULE_ID } from "../module/scripts/constants.mjs";

/**
 * §397: the launch message under the pause icon. dnd5e dresses the pause banner (its emblem, its font) only if it is
 * the only one registered on `renderGamePause`: the engine therefore does not register there,
 * and writes its message after the banner renders.
 */
const routes = new Map();
vi.mock("../module/scripts/runtime/router.mjs", () => ({
  route: (hook, handler) => routes.set(hook, [...(routes.get(hook) ?? []), handler])
}));
vi.mock("../module/scripts/runtime/group-roll.mjs", () => ({ requestGroupRoll: vi.fn(async () => null) }));
vi.mock("../module/scripts/adapter/vision.mjs", () => ({ canSee: () => true }));
vi.mock("../module/scripts/adapter/summons.mjs", () => ({ summonItemOf: () => null }));

const { registerCombatLaunch, LAUNCH_STATE } = await import("../module/scripts/runtime/combat-launch.mjs");

const settings = new Map();
const registered = new Map();
let caption;

beforeEach(() => {
  routes.clear();
  settings.clear();
  registered.clear();
  caption = { innerText: "" };
  globalThis.game = {
    paused: true, user: { isGM: false, id: "player" }, users: { activeGM: { isSelf: false } },
    i18n: { localize: key => `«${key}»`, format: key => `«${key}»` },
    settings: {
      register: (scope, key, data) => registered.set(`${scope}.${key}`, data),
      get: (scope, key) => settings.get(`${scope}.${key}`),
      set: async (scope, key, value) => settings.set(`${scope}.${key}`, value)
    }
  };
  // The core's banner: each render puts back the system's text.
  globalThis.ui = { pause: {
    renders: 0,
    element: { querySelector: selector => ((selector === "figcaption") ? caption : null) },
    async render() { this.renders += 1; caption.innerText = "Game Paused"; return this; }
  } };
  registerCombatLaunch();
});

afterEach(() => { delete globalThis.game; delete globalThis.ui; });

const fire = async hook => { for ( const handler of routes.get(hook) ?? [] ) await handler(true); await new Promise(r => setTimeout(r, 0)); };
const pending = value => settings.set(`${MODULE_ID}.${LAUNCH_STATE}`, { pending: value });

describe("§397 : le bandeau de pause pendant le choix des participants", () => {
  it("no registration on renderGamePause: dnd5e stays alone on that hook and dresses the banner", () => {
    expect(routes.has("renderGamePause")).toBe(false);
  });

  it("launch pending, game paused: the launch message, after the banner renders", async () => {
    pending(true);
    await fire("pauseGame");
    expect(ui.pause.renders).toBe(1);
    expect(caption.innerText).toBe("«DND5ECOMBAT.Lancement.Pause»");
  });

  it("the launch state changes (world setting, received by all clients): the banner follows", async () => {
    const { onChange } = registered.get(`${MODULE_ID}.${LAUNCH_STATE}`);
    pending(true);
    await onChange();
    expect(caption.innerText).toBe("«DND5ECOMBAT.Lancement.Pause»");
    // The choice made or cancelled: the redrawn banner keeps the system's text.
    pending(false);
    await onChange();
    expect(caption.innerText).toBe("Game Paused");
  });

  it("a client that reloads during the choice finds the message again; out of pause, nothing is written", async () => {
    pending(true);
    await fire("ready");
    expect(caption.innerText).toBe("«DND5ECOMBAT.Lancement.Pause»");
    game.paused = false;
    await fire("pauseGame");
    expect(caption.innerText).toBe("Game Paused");
  });
});
