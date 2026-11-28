/**
 * A hand-placed Darkness source (negative light, a token that emits it) counts as Darkness for the rules: without this,
 * Blindsight and Truesight, judged by the core, stopped at its edges, where Devil's Sight could see.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { isPlainDarkness, discNearSegment, sensesThrough } from "../module/scripts/core/light.mjs";

describe("isPlainDarkness — quelle source compte", () => {
  it("active, not a preview, not the light of an engine area", () => {
    expect(isPlainDarkness({ active: true })).toBe(true);
    expect(isPlainDarkness({ active: false })).toBe(false);
    expect(isPlainDarkness({ active: true, preview: true })).toBe(false);
    expect(isPlainDarkness({ active: true, engineZone: true })).toBe(false);
  });
  it("from another level of the scene than the observer: not counted", () => {
    expect(isPlainDarkness({ active: true, onLevel: false })).toBe(false);
    expect(isPlainDarkness({ active: true, onLevel: true })).toBe(true);
  });
  it("within Darkness, Blindsight and Truesight pierce it; Darkvision does not", () => {
    const through = sensesThrough({ fog: false, darkness: true });
    expect(through).toContain("blindsight");
    expect(through).toContain("seeAll");
    expect(through).not.toContain("basicSight");
  });
});

describe("discNearSegment — a source far from the line is not sampled", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 600, y: 0 };
  it("on the line, at the edge, beyond an end", () => {
    expect(discNearSegment({ x: 300, y: 0, radius: 50 }, from, to)).toBe(true);
    expect(discNearSegment({ x: 300, y: 149, radius: 150 }, from, to)).toBe(true);
    expect(discNearSegment({ x: 300, y: 200, radius: 150 }, from, to)).toBe(false);
    expect(discNearSegment({ x: 700, y: 0, radius: 101 }, from, to)).toBe(true);
    expect(discNearSegment({ x: 800, y: 0, radius: 150 }, from, to)).toBe(false);
  });
  it("a line reduced to a point; an unknown radius: it is sampled", () => {
    expect(discNearSegment({ x: 10, y: 0, radius: 20 }, from, from)).toBe(true);
    expect(discNearSegment({ x: 100, y: 0, radius: 20 }, from, from)).toBe(false);
    expect(discNearSegment({ x: 5000, y: 5000 }, from, to)).toBe(true);
    expect(discNearSegment(null, from, to)).toBe(true);
  });
});

describe("blockedBetween — a scene Darkness source between two tokens", () => {
  let blockedBetween;
  const grid = { size: 100, sizeX: 100, sizeY: 100, units: "ft" };
  const scene = { grid, regions: [] };
  const tokenAt = x => ({ parent: scene, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } });
  /** A round source: center and radius in pixels. */
  const source = (x, radius, extra={}) => ({ active: true, isPreview: false, object: { document: { flags: {} } },
    testPoint: p => Math.hypot(p.x - x, p.y - 50) <= radius, ...extra });

  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null },
      settings: { register() {}, get: () => undefined }, i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    ({ blockedBetween } = await import("../module/scripts/adapter/vision.mjs"));
  }, 60000);
  afterEach(() => { delete globalThis.canvas; });
  const withSources = sources => { globalThis.canvas = { ready: true, scene, effects: { darknessSources: sources } }; };

  it("the target inside, the observer outside: Darkness", () => {
    withSources([source(650, 150)]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
  });
  it("the line joining them crosses it: Darkness; to the side: nothing", () => {
    withSources([source(350, 80)]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
    withSources([source(1200, 80)]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(false);
  });
  it("turned off, in preview, or light of an engine area: not counted here", () => {
    for ( const extra of [{ active: false }, { isPreview: true },
      { object: { document: { flags: { "dnd5e-combat": { region: "abc" } } } } }] ) {
      withSources([source(650, 150, extra)]);
      expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness, JSON.stringify(extra)).toBe(false);
    }
  });
  // Review of #117: `PointDarknessSource#testPoint` ignores elevation — on a scene with levels, a Darkness light on the
  // ground floor must not count between two tokens on the upper floor.
  it("scene with levels: only the sources of the observer's level count", () => {
    const onLevel = level => ({ ...tokenAt(0), level });
    const light = levels => ({ object: { document: { flags: {}, includedInLevel: id => !levels.length || levels.includes(id) } } });
    withSources([source(350, 80, light(["ground"]))]);
    expect(blockedBetween(onLevel("upper"), tokenAt(600)).darkness).toBe(false);
    expect(blockedBetween(onLevel("ground"), tokenAt(600)).darkness).toBe(true);
    // A light with no levels checked is on every level; an observer with no level (scene without levels) sees everything count.
    withSources([source(350, 80, light([]))]);
    expect(blockedBetween(onLevel("upper"), tokenAt(600)).darkness).toBe(true);
    withSources([source(350, 80, light(["ground"]))]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
    // With no document to say so: the level the source carries.
    withSources([source(350, 80, { object: null, data: { level: "ground" } })]);
    expect(blockedBetween(onLevel("upper"), tokenAt(600)).darkness).toBe(false);
    expect(blockedBetween(onLevel("ground"), tokenAt(600)).darkness).toBe(true);
  });
  it("a source whose circle is far from the line is not queried", () => {
    let asked = 0;
    const far = { ...source(350, 80), x: 350, y: 900, radius: 80, testPoint: () => { asked++; return true; } };
    withSources([far]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(false);
    expect(asked).toBe(0);
    const near = { ...far, y: 50 };
    withSources([near]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
    expect(asked).toBeGreaterThan(0);
  });
  it("a scene other than the displayed one, or a canvas not ready: nothing", () => {
    withSources([source(650, 150)]);
    const elsewhere = { grid, regions: [] };
    const far = x => ({ parent: elsewhere, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } });
    expect(blockedBetween(far(0), far(600)).darkness).toBe(false);
    globalThis.canvas = { ready: false, scene, effects: { darknessSources: [source(650, 150)] } };
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(false);
  });
});
