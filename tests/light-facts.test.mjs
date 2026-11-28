/**
 * Issue #69, block 6: the light of the place as a rule's condition — `inDimLight` and `inDarkness` for the attacker, the
 * creature itself and the target, beside `inBrightLight`. Generic example: Advantage against a target in dim light or darkness.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

const SUBJECTS = ["source", "self", "target"];
const KEYS = SUBJECTS.flatMap(s => [`${s}.inDimLight`, `${s}.inDarkness`]);

describe("light facts (issue #69, block 6)", () => {
  let factsFor;
  let before;
  // A scene without global light, a torch at (0, 0): bright up to 100 px, dim up to 300 px, nothing beyond.
  const torch = { active: true, isPreview: false, data: { x: 0, y: 0, bright: 100, priority: 0, elevation: 0 },
    testPoint: p => Math.hypot(p.x, p.y) <= 300 };
  const lit = { ready: true, dimensions: { distancePixels: 20 }, environment: { globalLightSource: null, darknessLevel: 1 },
    effects: { lightSources: [torch], darknessSources: [], illumination: null } };
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null },
      settings: { register() {}, get: () => undefined }, i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.foundry.canvas ??= { sources: { GlobalLightSource: class {} } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    before = globalThis.canvas;
    await import("../module/scripts/adapter/running-water.mjs");   // same load order as tests/self-facts.test.mjs
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });
  afterAll(() => { globalThis.canvas = before; });

  /** A one-square token whose centre is `x` px from the torch; `light`: 2 bright (50), 1 dim (200), 0 darkness (500). */
  const X = { 2: 50, 1: 200, 0: 500 };
  const token = light => {
    const x = X[light] - 50;
    return { x, y: -50, width: 1, height: 1, elevation: 0, _source: { x, y: -50, width: 1, height: 1, elevation: 0 },
      parent: { grid: { size: 100, sizeX: 100, sizeY: 100 }, dimensions: { size: 100 } } };
  };
  const all = (light, scene=lit) => {
    globalThis.canvas = scene;
    return factsFor({ source: { name: "a" }, sourceToken: token(light), self: { name: "s" }, selfToken: token(light),
      target: { name: "t" }, targetToken: token(light) });
  };

  it("dim light: `inDimLight` only; darkness: `inDarkness` only; bright light: neither", () => {
    for ( const s of SUBJECTS ) {
      expect(all(1)[`${s}.inDimLight`](true), s).toBe(true);
      expect(all(1)[`${s}.inDarkness`](true), s).toBe(false);
      expect(all(0)[`${s}.inDarkness`](true), s).toBe(true);
      expect(all(0)[`${s}.inDimLight`](true), s).toBe(false);
      expect(all(2)[`${s}.inDimLight`](true), s).toBe(false);
      expect(all(2)[`${s}.inDarkness`](true), s).toBe(false);
      expect(all(2)[`${s}.inDarkness`](false), s).toBe(true);
    }
  });

  it("each reads the light of its own token", () => {
    globalThis.canvas = lit;
    const f = factsFor({ source: { name: "a" }, sourceToken: token(2), target: { name: "t" }, targetToken: token(0) });
    expect(f["source.inDarkness"](true)).toBe(false);
    expect(f["target.inDarkness"](true)).toBe(true);
  });

  it("no token, or no ready scene: neither dim light nor darkness (unknown)", () => {
    globalThis.canvas = lit;
    const none = factsFor();
    const unready = all(0, null);
    for ( const key of KEYS ) {
      expect(none[key](true), key).toBe(false);
      expect(unready[key](true), key).toBe(false);
    }
  });

  it("\"Advantage against a target in dim light or darkness\": a valid entry that holds in both", () => {
    const when = { any: [{ "target.inDimLight": true }, { "target.inDarkness": true }] };
    const entry = { triggers: [{ on: "preAttackRoll", if: when, do: [{ type: "advantage" }] }] };
    expect(validateEntry(entry, { facts: all(2) })).toEqual([]);
    expect(holds(when, all(1))).toBe(true);
    expect(holds(when, all(0))).toBe(true);
    expect(holds(when, all(2))).toBe(false);
  });
});
