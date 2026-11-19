/**
 * Une source de ténèbres posée à la main (lumière négative, token qui en émet) compte comme des ténèbres pour les règles : sans
 * cela la vision aveugle et la vision véritable, jugées par le cœur, s'arrêtaient à ses bords, là où la Vision du diable voyait.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { isPlainDarkness, discNearSegment, sensesThrough } from "../module/scripts/core/light.mjs";

describe("isPlainDarkness — quelle source compte", () => {
  it("active, pas un aperçu, pas la lumière d'une zone du moteur", () => {
    expect(isPlainDarkness({ active: true })).toBe(true);
    expect(isPlainDarkness({ active: false })).toBe(false);
    expect(isPlainDarkness({ active: true, preview: true })).toBe(false);
    expect(isPlainDarkness({ active: true, engineZone: true })).toBe(false);
  });
  it("d'un autre niveau de la scène que l'observateur : pas comptée", () => {
    expect(isPlainDarkness({ active: true, onLevel: false })).toBe(false);
    expect(isPlainDarkness({ active: true, onLevel: true })).toBe(true);
  });
  it("dans des ténèbres, la vision aveugle et la vision véritable percent ; la vision dans le noir, non", () => {
    const through = sensesThrough({ fog: false, darkness: true });
    expect(through).toContain("blindsight");
    expect(through).toContain("seeAll");
    expect(through).not.toContain("basicSight");
  });
});

describe("discNearSegment — une source loin du trait n'est pas échantillonnée", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 600, y: 0 };
  it("sur le trait, au bord, au-delà d'une extrémité", () => {
    expect(discNearSegment({ x: 300, y: 0, radius: 50 }, from, to)).toBe(true);
    expect(discNearSegment({ x: 300, y: 149, radius: 150 }, from, to)).toBe(true);
    expect(discNearSegment({ x: 300, y: 200, radius: 150 }, from, to)).toBe(false);
    expect(discNearSegment({ x: 700, y: 0, radius: 101 }, from, to)).toBe(true);
    expect(discNearSegment({ x: 800, y: 0, radius: 150 }, from, to)).toBe(false);
  });
  it("un trait réduit à un point ; un rayon inconnu : on échantillonne", () => {
    expect(discNearSegment({ x: 10, y: 0, radius: 20 }, from, from)).toBe(true);
    expect(discNearSegment({ x: 100, y: 0, radius: 20 }, from, from)).toBe(false);
    expect(discNearSegment({ x: 5000, y: 5000 }, from, to)).toBe(true);
    expect(discNearSegment(null, from, to)).toBe(true);
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
  // Revue de #117 : `PointDarknessSource#testPoint` ignore l'élévation — sur une scène à niveaux, une lumière de ténèbres du
  // rez-de-chaussée ne doit pas compter entre deux tokens de l'étage.
  it("scène à niveaux : seules les sources du niveau de l'observateur comptent", () => {
    const onLevel = level => ({ ...tokenAt(0), level });
    const light = levels => ({ object: { document: { flags: {}, includedInLevel: id => !levels.length || levels.includes(id) } } });
    withSources([source(350, 80, light(["ground"]))]);
    expect(blockedBetween(onLevel("upper"), tokenAt(600)).darkness).toBe(false);
    expect(blockedBetween(onLevel("ground"), tokenAt(600)).darkness).toBe(true);
    // Une lumière sans niveaux cochés est de tous les niveaux ; un observateur sans niveau (scène sans niveaux) voit tout compter.
    withSources([source(350, 80, light([]))]);
    expect(blockedBetween(onLevel("upper"), tokenAt(600)).darkness).toBe(true);
    withSources([source(350, 80, light(["ground"]))]);
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(true);
    // Sans document qui le dise : le niveau que porte la source.
    withSources([source(350, 80, { object: null, data: { level: "ground" } })]);
    expect(blockedBetween(onLevel("upper"), tokenAt(600)).darkness).toBe(false);
    expect(blockedBetween(onLevel("ground"), tokenAt(600)).darkness).toBe(true);
  });
  it("une source dont le cercle est loin du trait n'est pas interrogée", () => {
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
  it("une autre scène que celle affichée, ou un canevas pas prêt : rien", () => {
    withSources([source(650, 150)]);
    const elsewhere = { grid, regions: [] };
    const far = x => ({ parent: elsewhere, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } });
    expect(blockedBetween(far(0), far(600)).darkness).toBe(false);
    globalThis.canvas = { ready: false, scene, effects: { darknessSources: [source(650, 150)] } };
    expect(blockedBetween(tokenAt(0), tokenAt(600)).darkness).toBe(false);
  });
});
