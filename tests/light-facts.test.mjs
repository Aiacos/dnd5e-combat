/**
 * Issue #69, bloc 6 : la lumière du lieu comme condition d'une règle — `inDimLight` et `inDarkness` pour l'attaquant, la créature
 * elle-même et la cible, à côté de `inBrightLight`. Exemple générique : l'Avantage contre une cible en lumière faible ou dans les
 * ténèbres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { holds } from "../module/scripts/core/triggers.mjs";

const SUBJECTS = ["source", "self", "target"];
const KEYS = SUBJECTS.flatMap(s => [`${s}.inDimLight`, `${s}.inDarkness`]);

describe("faits de lumière (issue #69, bloc 6)", () => {
  let factsFor;
  let before;
  // Une scène sans lumière globale, une torche en (0, 0) : vive jusqu'à 100 px, faible jusqu'à 300 px, rien au-delà.
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
    await import("../module/scripts/adapter/running-water.mjs");   // même ordre de chargement que tests/self-facts.test.mjs
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });
  afterAll(() => { globalThis.canvas = before; });

  /** Un token d'une case dont le centre est à `x` px de la torche ; `light` : 2 vive (50), 1 faible (200), 0 ténèbres (500). */
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

  it("lumière faible : `inDimLight` seul ; ténèbres : `inDarkness` seul ; lumière vive : ni l'un ni l'autre", () => {
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

  it("chacun lit la lumière de son propre token", () => {
    globalThis.canvas = lit;
    const f = factsFor({ source: { name: "a" }, sourceToken: token(2), target: { name: "t" }, targetToken: token(0) });
    expect(f["source.inDarkness"](true)).toBe(false);
    expect(f["target.inDarkness"](true)).toBe(true);
  });

  it("sans token, ou sans scène prête : ni lumière faible ni ténèbres (on ne sait pas)", () => {
    globalThis.canvas = lit;
    const none = factsFor();
    const unready = all(0, null);
    for ( const key of KEYS ) {
      expect(none[key](true), key).toBe(false);
      expect(unready[key](true), key).toBe(false);
    }
  });

  it("« l'Avantage contre une cible en lumière faible ou dans les ténèbres » : une entrée valide, qui tient dans les deux", () => {
    const when = { any: [{ "target.inDimLight": true }, { "target.inDarkness": true }] };
    const entry = { triggers: [{ on: "preAttackRoll", if: when, do: [{ type: "advantage" }] }] };
    expect(validateEntry(entry, { facts: all(2) })).toEqual([]);
    expect(holds(when, all(1))).toBe(true);
    expect(holds(when, all(0))).toBe(true);
    expect(holds(when, all(2))).toBe(false);
  });
});
