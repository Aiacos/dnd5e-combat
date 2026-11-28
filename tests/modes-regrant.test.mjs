/**
 * The detection modes granted in memory (hearing of a Blinded creature, Devil's Sight — ui/perception.mjs, `grantOn`): the client
 * rebuilds the whole scene, hence the prepared data of ALL its tokens, after the creation, update or deletion of one of
 * its documents. These modes must return on every token of the displayed scene, not only on the updated token.
 */
import { describe, it, expect, beforeAll } from "vitest";

const hooks = {};
const fire = (hook, ...args) => (hooks[hook] ?? []).forEach(fn => fn(...args));
const scene = { tokens: [] };
const elsewhere = { tokens: [] };

/** A scene token with a vision source; `reset` rebuilds its modes from the source, like `TokenDocument#reset`. */
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

describe("the in-memory modes after a change on the scene", () => {
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
      expect(sightless.detectionModes.dasHearing).toBeUndefined();        // no vision source: nothing to grant
      if ( !hook.endsWith("Token") ) expect(canvas.refreshes).toBe(before);
    });

  it("a document from another scene does not touch the displayed scene's tokens, nor its own", () => {
    scene.tokens.length = 0;
    const observer = tokenOn(scene), far = tokenOn(elsewhere);
    observer.reset();
    fire("updateDrawing", { parent: elsewhere }, {}, {}, "user");
    expect(observer.detectionModes.dasHearing).toBeUndefined();
    expect(far.detectionModes.dasHearing).toBeUndefined();
  });
});
