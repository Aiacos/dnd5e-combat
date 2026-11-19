/**
 * Issue #108 : deux téléportations de soi lancées l'une pendant l'autre sur le même client (le joueur relance la Foulée brumeuse
 * alors que la visée de la première est encore ouverte). Chacune garde sa propre visée : la fin de la première ne retire pas celle
 * de la seconde.
 */
import { describe, it, expect, beforeAll } from "vitest";

let teleportSelf, currentTeleport;

/** Une activité native « teleport » dont la planification du cœur reste ouverte jusqu'à `close(results)`. */
function nativeTeleport(token) {
  const activity = { type: "teleport", id: "a", range: { units: "self" }, canPlanTeleport: true,
    teleport: { value: 30, units: "ft" }, getUsageToken: () => token,
    planTeleport: () => new Promise(resolve => { activity.close = resolve; }) };
  return activity;
}

beforeAll(async () => {
  globalThis.Hooks = { on() {}, once() {}, callAll() {}, call: () => true };
  globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null },
    settings: { register() {}, get: () => undefined }, i18n: { localize: k => k, format: k => k, lang: "en" } };
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
  globalThis.CONFIG = { DND5E: {}, specialStatusEffects: {}, queries: {}, Canvas: { detectionModes: {} } };
  globalThis.ui = { notifications: { info() {}, warn() {} } };
  ({ teleportSelf, currentTeleport } = await import("../module/scripts/runtime/teleport.mjs"));
}, 60000);

describe("issue #108 : téléportations de soi qui se chevauchent", () => {
  it("la première abandonnée ne casse pas la seconde, qui garde sa visée jusqu'à sa propre fin", async () => {
    const scene = { grid: { units: "ft" } };
    const token = { uuid: "Scene.s.Token.t", parent: scene, _source: { x: 0, y: 0, elevation: 0 }, object: { control() {} } };
    const first = nativeTeleport(token), second = nativeTeleport(token);
    const one = teleportSelf(first);
    await new Promise(resolve => setTimeout(resolve, 0));
    const two = teleportSelf(second);
    await new Promise(resolve => setTimeout(resolve, 0));
    const aim = currentTeleport();
    first.close([]);                                   // Échap sur la première visée
    await expect(one).resolves.toBe(false);
    expect(currentTeleport()).toBe(aim);               // la visée de la seconde est toujours là
    second.close([]);
    await expect(two).resolves.toBe(false);            // avant : TypeError, `teleporting` était null
    expect(currentTeleport()).toBeNull();
  });
});
