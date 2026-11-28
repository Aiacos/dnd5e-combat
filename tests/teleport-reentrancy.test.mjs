/**
 * Issue #108: two self-teleports launched one during the other on the same client (the player relaunches Misty Step
 * while the first one's targeting is still open). Each keeps its own targeting: the end of the first does not remove that
 * of the second.
 */
import { describe, it, expect, beforeAll } from "vitest";

let teleportSelf, currentTeleport;

/** A native "teleport" activity whose core planning stays open until `close(results)`. */
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

describe("issue #108: self-teleports that overlap", () => {
  it("the first one abandoned does not break the second, which keeps its targeting until its own end", async () => {
    const scene = { grid: { units: "ft" } };
    const token = { uuid: "Scene.s.Token.t", parent: scene, _source: { x: 0, y: 0, elevation: 0 }, object: { control() {} } };
    const first = nativeTeleport(token), second = nativeTeleport(token);
    const one = teleportSelf(first);
    await new Promise(resolve => setTimeout(resolve, 0));
    const two = teleportSelf(second);
    await new Promise(resolve => setTimeout(resolve, 0));
    const aim = currentTeleport();
    first.close([]);                                   // Escape on the first targeting
    await expect(one).resolves.toBe(false);
    expect(currentTeleport()).toBe(aim);               // the second one's targeting is still there
    second.close([]);
    await expect(two).resolves.toBe(false);            // before: TypeError, `teleporting` was null
    expect(currentTeleport()).toBeNull();
  });
});
