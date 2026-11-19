/**
 * Une source de ténèbres posée à la main (lumière négative, token qui en émet) compte comme des ténèbres pour les règles : sans
 * cela la vision aveugle et la vision véritable, jugées par le cœur, s'arrêtaient à ses bords, là où la Vision du diable voyait.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { isPlainDarkness, sensesThrough } from "../module/scripts/core/light.mjs";

describe("isPlainDarkness — quelle source compte", () => {
  it("active, pas un aperçu, pas la lumière d'une zone du moteur", () => {
    expect(isPlainDarkness({ active: true })).toBe(true);
    expect(isPlainDarkness({ active: false })).toBe(false);
    expect(isPlainDarkness({ active: true, preview: true })).toBe(false);
    expect(isPlainDarkness({ active: true, engineZone: true })).toBe(false);
  });
  it("dans des ténèbres, la vision aveugle et la vision véritable percent ; la vision dans le noir, non", () => {
    const through = sensesThrough({ fog: false, darkness: true });
    expect(through).toContain("blindsight");
    expect(through).toContain("seeAll");
    expect(through).not.toContain("basicSight");
  });
});

describe("blockedBetween — une source de ténèbres de la scène entre deux tokens", () => {
  let blockedBetween;
  const grid = { size: 100, sizeX: 100, sizeY: 100, units: "ft" };
  const scene = { grid, regions: [] };
  const tokenAt = x => ({ parent: scene, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } });
  /** Une source ronde : centre et rayon en pixels. */
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

  it("la cible dedans, l'observateur dehors : des ténèbres", () => {
    withSources([source(650, 150)]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
  });
  it("le trait qui les relie la traverse : des ténèbres ; à côté : rien", () => {
    withSources([source(350, 80)]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
    withSources([source(1200, 80)]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(false);
  });
  it("éteinte, en aperçu, ou lumière d'une zone du moteur : pas comptée ici", () => {
    for ( const extra of [{ active: false }, { isPreview: true },
      { object: { document: { flags: { "dnd5e-combat": { region: "abc" } } } } }] ) {
      withSources([source(650, 150, extra)]);
      expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness, JSON.stringify(extra)).toBe(false);
    }
  });
  it("une autre scène que celle affichée, ou un canevas pas prêt : rien", () => {
    withSources([source(650, 150)]);
    const elsewhere = { grid, regions: [] };
    const far = x => ({ parent: elsewhere, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } });
    expect(blockedBetween(far(0), far(600)).darkness).toBe(false);
    globalThis.canvas = { ready: false, scene, effects: { darknessSources: [source(650, 150)] } };
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(false);
  });
});
