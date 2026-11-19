/**
 * Les modes de détection donnés en mémoire (ouïe d'un Aveuglé, Vision du diable — ui/perception.mjs, `grantOn`) : le client refait
 * la scène entière, donc les données préparées de TOUS ses tokens, après la création, la mise à jour ou la suppression d'un de
 * ses documents. Ces modes doivent revenir sur chaque token de la scène affichée, pas seulement sur le token mis à jour.
 */
import { describe, it, expect, beforeAll } from "vitest";

const hooks = {};
const fire = (hook, ...args) => (hooks[hook] ?? []).forEach(fn => fn(...args));
const scene = { tokens: [] };
const elsewhere = { tokens: [] };

/** Un token de scène avec une source de vision ; `reset` refait ses modes depuis la source, comme `TokenDocument#reset`. */
function tokenOn(parent, { sight=true }={}) {
  const doc = { parent, sight: { enabled: sight }, actor: null, object: null, detectionModes: {},
    reset() { doc.detectionModes = { basicSight: { enabled: true, range: 60 } }; } };
  doc.reset();
  parent.tokens.push(doc);
  return doc;
}

beforeAll(async () => {
  globalThis.Hooks = { on: (hook, fn) => (hooks[hook] ??= []).push(fn), once() {}, callAll() {}, call: () => true };
  globalThis.game = { user: { isGM: false }, users: {}, modules: { get: () => null },
    settings: { register() {}, get: () => undefined }, i18n: { localize: k => k, format: k => k, lang: "en" } };
  class DetectionMode {
    static DETECTION_TYPES = { SIGHT: 0, SOUND: 1 };
    constructor(data) { Object.assign(this, data); this.data = data; }
    toObject() { return this.data; }
    testVisibility() { return false; }
  }
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false },
    canvas: { perception: { DetectionMode }, placeables: { Token: class {} },
      rendering: { filters: { OutlineOverlayFilter: { create: () => ({}) } } } } };
  globalThis.fromUuidSync = () => null;
  globalThis.CONFIG = { DND5E: {}, specialStatusEffects: {}, queries: {}, Canvas: { detectionModes: {} } };
  globalThis.canvas = { ready: true, scene, grid: { size: 100 }, tokens: { placeables: [] },
    perception: { update() { canvas.refreshes++; } }, refreshes: 0 };
  const { registerPerception } = await import("../module/scripts/ui/perception.mjs");
  registerPerception();
  fire("setup");
}, 60000);

describe("les modes en mémoire après un changement sur la scène", () => {
  it.each([["updateToken"], ["createDrawing"], ["updateDrawing"], ["deleteTile"], ["updateWall"]])(
    "%s : la scène est refaite, chaque token retrouve l'ouïe — sans refaire la vue", hook => {
      scene.tokens.length = 0;
      const observer = tokenOn(scene), bystander = tokenOn(scene), sightless = tokenOn(scene, { sight: false });
      const changed = hook.endsWith("Token") ? tokenOn(scene) : { parent: scene };
      for ( const doc of scene.tokens ) doc.reset();                       // ce que fait `Scene#reset` avant le hook
      const before = canvas.refreshes;
      fire(hook, changed, {}, {}, "user");
      expect(observer.detectionModes.dasHearing).toEqual({ enabled: true, range: Infinity });
      expect(bystander.detectionModes.dasHearing).toEqual({ enabled: true, range: Infinity });
      expect(sightless.detectionModes.dasHearing).toBeUndefined();        // pas de source de vision : rien à donner
      if ( !hook.endsWith("Token") ) expect(canvas.refreshes).toBe(before);
    });

  it("un document d'une autre scène ne touche pas aux tokens de la scène affichée, ni aux siens", () => {
    scene.tokens.length = 0;
    const observer = tokenOn(scene), far = tokenOn(elsewhere);
    observer.reset();
    fire("updateDrawing", { parent: elsewhere }, {}, {}, "user");
    expect(observer.detectionModes.dasHearing).toBeUndefined();
    expect(far.detectionModes.dasHearing).toBeUndefined();
  });
});
