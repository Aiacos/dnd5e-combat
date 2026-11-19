/**
 * Issue #104 : `canSee` ne rejoue que les modes de détection que le moteur connaît et juge. Un mode inscrit par un autre module
 * (une « ouïe » à portée) répondait « oui » pour une créature Invisible toute proche : elle passait pour vue, et l'attaque
 * perdait son Désavantage.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { JUDGED_MODES, judgedModes, CORE_JUDGED, DEVILS_SIGHT, sensesThrough } from "../module/scripts/core/light.mjs";

describe("judgedModes — les modes d'un token que le moteur juge", () => {
  const own = { basicSight: { range: 60 }, lightPerception: { range: null }, blindsight: { range: 30 }, seeAll: { range: 10 },
    feelTremor: { range: 60 }, devilsSight: { range: 120 }, hearing: { range: 15 }, thermalVision: { range: 60 } };

  it("garde ceux du cœur, de dnd5e et du moteur ; écarte ceux d'un autre module", () => {
    expect(Object.keys(judgedModes(own)).sort())
      .toEqual(["basicSight", "blindsight", "devilsSight", "feelTremor", "lightPerception", "seeAll"]);
    expect(judgedModes(own).blindsight).toBe(own.blindsight);
  });

  it("la liste couvre tout ce que le moteur nomme ailleurs", () => {
    for ( const id of [...CORE_JUDGED, DEVILS_SIGHT.mode, ...sensesThrough({ fog: false, darkness: true })] ) {
      expect(JUDGED_MODES, id).toContain(id);
    }
  });

  it("« See Invisibility » du cœur, coché à la main par le MJ, est jugé : à l'écran comme aux règles", () => {
    expect(JUDGED_MODES).toContain("seeInvisibility");
    expect(Object.keys(judgedModes({ seeInvisibility: { range: 60 }, hearing: { range: 15 } }))).toEqual(["seeInvisibility"]);
  });

  it("sans modes : un objet vide", () => {
    expect(judgedModes(null)).toEqual({});
    expect(judgedModes(undefined)).toEqual({});
  });
});

describe("canSee — un mode de détection d'un autre module ne fait pas voir", () => {
  let canSee;
  const answers = {};   // id du mode → ce que son test répond
  const asked = [];
  const REGISTERED = ["basicSight", "lightPerception", "blindsight", "hearing"];
  const grid = { size: 100, sizeX: 100, sizeY: 100, units: "ft", distance: 5 };
  const scene = { grid, regions: [], tokens: [], levels: null };
  const tokenDoc = (id, x, detectionModes) => {
    const doc = { id, parent: scene, detectionModes, sight: { enabled: true, range: 0 }, hidden: false, disposition: -1,
      level: null, _source: { x, y: 0, width: 1, height: 1, elevation: 0 }, flags: {}, getFlag: () => undefined,
      actor: { items: [], effects: [], statuses: new Set(), flags: {} }, hasStatusEffect: () => false,
      getVisionOrigin: () => ({ x, y: 0, elevation: 0 }), getVisibilityTestPoints: () => [{ x, y: 0 }] };
    doc.object = { document: doc, destroyed: false, isVisible: true, _getVisionSourceData: () => ({}),
      _getVisionBlindedStates: () => ({}) };
    return doc;
  };

  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null }, combat: null,
      settings: { register() {}, get: () => undefined }, i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    const mode = id => ({ testVisibility: () => { asked.push(id); return answers[id] === true; } });
    globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: { INVISIBLE: "invisible" },
      queries: {}, Canvas: { visionSourceClass: class { constructor() { this.blinded = {}; } initialize() {} destroy() {} },
        detectionModes: Object.fromEntries(REGISTERED.map(id => [id, mode(id)])) } };
    globalThis.canvas = { ready: true, scene, level: null, effects: { lightSources: [], darknessSources: [] } };
    ({ canSee } = await import("../module/scripts/adapter/vision.mjs"));
  }, 60000);
  beforeEach(() => { asked.length = 0; for ( const id of Object.keys(answers) ) delete answers[id]; });

  it("une « ouïe » inscrite par un autre module répond oui : la cible n'est pas vue, et ce mode n'est pas interrogé", () => {
    const observer = tokenDoc("o", 0, { basicSight: { enabled: true, range: 60 }, hearing: { enabled: true, range: 15 } });
    const target = tokenDoc("t", 100, {});
    answers.hearing = true;
    expect(canSee(observer, target)).toBe(false);
    expect(asked).not.toContain("hearing");
    expect(asked).toContain("basicSight");
  });

  it("un mode que le moteur juge répond oui : la cible est vue", () => {
    const observer = tokenDoc("o2", 0, { basicSight: { enabled: true, range: 60 }, blindsight: { enabled: true, range: 30 },
      hearing: { enabled: true, range: 15 } });
    const target = tokenDoc("t2", 100, {});
    answers.blindsight = true;
    expect(canSee(observer, target)).toBe(true);
    expect(asked).not.toContain("hearing");
  });
});
