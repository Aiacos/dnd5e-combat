import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MODULE_ID } from "../module/scripts/constants.mjs";

/**
 * §397 : le message du lancement sous l'icône de pause. dnd5e n'habille le bandeau de pause (son emblème, sa police) que s'il est
 * le seul inscrit à `renderGamePause` : le moteur ne s'y inscrit donc pas, et écrit son message après le rendu du bandeau.
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
  // Le bandeau du cœur : chaque rendu remet le texte du système.
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
  it("aucune inscription à renderGamePause : dnd5e reste seul sur ce hook et habille le bandeau", () => {
    expect(routes.has("renderGamePause")).toBe(false);
  });

  it("lancement en attente, jeu en pause : le message du lancement, après le rendu du bandeau", async () => {
    pending(true);
    await fire("pauseGame");
    expect(ui.pause.renders).toBe(1);
    expect(caption.innerText).toBe("«DND5ECOMBAT.Lancement.Pause»");
  });

  it("l'état du lancement change (réglage de monde, reçu par tous les clients) : le bandeau suit", async () => {
    const { onChange } = registered.get(`${MODULE_ID}.${LAUNCH_STATE}`);
    pending(true);
    await onChange();
    expect(caption.innerText).toBe("«DND5ECOMBAT.Lancement.Pause»");
    // Le choix fait ou annulé : le bandeau redessiné garde le texte du système.
    pending(false);
    await onChange();
    expect(caption.innerText).toBe("Game Paused");
  });

  it("un client qui recharge pendant le choix retrouve le message ; hors pause, rien n'est écrit", async () => {
    pending(true);
    await fire("ready");
    expect(caption.innerText).toBe("«DND5ECOMBAT.Lancement.Pause»");
    game.paused = false;
    await fire("pauseGame");
    expect(caption.innerText).toBe("Game Paused");
  });
});
