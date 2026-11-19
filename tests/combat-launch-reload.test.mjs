import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MODULE_ID } from "../module/scripts/constants.mjs";

/**
 * §397 : le lancement en attente (pause de la table, message sous l'icône de pause) ne se lève qu'à la fermeture de la fenêtre du MJ.
 * Un MJ qui recharge sa page fenêtre ouverte n'a plus de fenêtre à fermer : au chargement, son lancement resté en attente est annulé.
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

describe("§397 : un lancement resté en attente après un rechargement", () => {
  it("le MJ qui avait ouvert la fenêtre recharge : le lancement est annulé, la pause d'avant revient", async () => {
    expect(await beginLaunch()).toBe(true);
    expect(launchApi.pending()).toBe(true);
    expect(game.paused).toBe(true);
    // Le rechargement : la fenêtre n'existe plus, `ready` repasse.
    await routes.get("ready")?.();
    expect(launchApi.pending()).toBe(false);
    expect(game.paused).toBe(false);
  });

  it("le jeu était déjà en pause avant : il le reste", async () => {
    game.paused = true;
    await beginLaunch();
    game.togglePause.mockClear();
    await routes.get("ready")?.();
    expect(launchApi.pending()).toBe(false);
    expect(game.togglePause).not.toHaveBeenCalled();
  });

  it("le lancement d'un autre MJ, dont la fenêtre est peut-être encore ouverte, n'est pas touché", async () => {
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
