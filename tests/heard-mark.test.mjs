/**
 * Issue #42: the ear of heard creatures (ui/perception.mjs, `refreshMark`) is decided on each `refreshToken` and
 * `hoverToken` of each token. `Token#isVisible` reruns the core's whole visibility test on every read: as long as this
 * client has heard nothing (the hearing filter does not exist yet), no token can be "heard" and the test does not need to be
 * redone.
 */
import { describe, it, expect, beforeAll } from "vitest";

const hooks = {};
const fire = (hook, ...args) => hooks[hook].forEach(fn => fn(...args));
const layer = { children: [], addChild(child) { child.parent = layer; layer.children.push(child); return child; } };
const hearing = { name: "le filtre de l'ouïe" };
const sensing = { name: "le filtre des sens déclarés" };
let anonymous = false;   // the world's `anonymousLocated` setting

/** A canvas token; `tests` counts the reads of `isVisible` (one core visibility test each). */
function tokenOf(id, { visible=true, detectionFilter=null }={}) {
  const token = { id, document: { id }, destroyed: false, detectionFilter, hover: false, x: 100, y: 100, tests: 0 };
  Object.defineProperty(token, "isVisible", { get() { token.tests++; return visible; } });
  return token;
}

beforeAll(async () => {
  globalThis.Hooks = { on: (hook, fn) => (hooks[hook] ??= []).push(fn), once() {}, callAll() {}, call: () => true };
  globalThis.game = { user: { isGM: false }, users: {}, modules: { get: () => null },
    settings: { register() {}, get: (scope, key) => (key === "anonymousLocated") ? anonymous : undefined },
    i18n: { localize: k => k, format: k => k, lang: "en" } };
  class DetectionMode {
    static DETECTION_TYPES = { SIGHT: 0, SOUND: 1 };
    constructor(data) { Object.assign(this, data); this.data = data; }
    toObject() { return this.data; }
    testVisibility() { return false; }
  }
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false },
    canvas: { perception: { DetectionMode }, placeables: { Token: class {} },
      rendering: { filters: { OutlineOverlayFilter: { create: ({ outlineColor }) => ((outlineColor[0] > 0.7) ? sensing : hearing) } } } } };
  globalThis.fromUuidSync = () => null;
  globalThis.CONFIG = { DND5E: {}, specialStatusEffects: {}, queries: {}, Canvas: { detectionModes: {} },
    Token: { documentClass: { DEFAULT_ICON: "icons/svg/mystery-man.svg" } } };
  // What `buildMark` draws: PIXI containers without rendering.
  class Node {
    constructor() {
      this.children = [];
      this.position = { set: (x, y) => Object.assign(this.position, { x, y }) };
      this.anchor = { set() {} };
    }
    addChild(...children) {
      for ( const child of children ) child.parent = this;
      this.children.push(...children);
      return children[0];
    }
    destroy() { this.destroyed = true; }
  }
  class Graphics extends Node {
    clear() { return this; }
    beginFill() { return this; }
    drawCircle() { return this; }
    endFill() { return this; }
    lineStyle() { return this; }
  }
  globalThis.PIXI = { Container: Node, Graphics, Text: Node, Sprite: Node, Texture: { from: path => ({ path }) } };
  globalThis.canvas = { ready: true, scene: {}, grid: { size: 100 }, interface: layer, tokens: { placeables: [] } };
  const { registerPerception } = await import("../module/scripts/ui/perception.mjs");
  registerPerception();
}, 60000);

describe("issue #42: the ear of heard creatures", () => {
  it("as long as nothing has been heard on this client: no ear, and no visibility test rerun", () => {
    const tokens = Array.from({ length: 40 }, (_, n) => tokenOf(`t${n}`));
    for ( const token of tokens ) fire("refreshToken", token, {});
    for ( const token of tokens ) fire("hoverToken", token, true);
    expect(layer.children).toHaveLength(0);
    expect(tokens.reduce((sum, token) => sum + token.tests, 0)).toBe(0);
  });

  it("once the hearing filter is created: the ear on the heard and visible token, not on the others — as before", () => {
    fire("setup");
    // The core asks the hearing mode for its filter for the first heard token.
    expect(CONFIG.Canvas.detectionModes.dasHearing.constructor.getDetectionFilter()).toBe(hearing);
    const heard = tokenOf("heard", { detectionFilter: hearing });
    const seen = tokenOf("seen");                                           // vu normalement : aucun filtre
    const other = tokenOf("other", { detectionFilter: { name: "un autre contour" } });   // perception des vibrations…
    const gone = tokenOf("gone", { visible: false, detectionFilter: hearing });          // no longer displayed
    for ( const token of [heard, seen, other, gone] ) fire("refreshToken", token, {});
    const marks = layer.children[0].children;
    expect(marks).toHaveLength(1);
    expect(marks[0].position.x).toBeCloseTo(heard.x + (13 * 0.6));   // top-left corner, radius of 13 px for a 100 cell
    expect(marks[0].position.y).toBeCloseTo(heard.y + (13 * 0.6));
    expect(heard.tests).toBe(1);
    // Il n'est plus entendu : l'oreille part.
    heard.detectionFilter = null;
    fire("refreshToken", heard, {});
    expect(marks[0].destroyed).toBe(true);
  });

  it("a creature located by a declared sense: its own mark, replaced if it is no longer anything but heard", () => {
    expect(CONFIG.Canvas.detectionModes.dasSense.constructor.getDetectionFilter()).toBe(sensing);
    const located = tokenOf("located", { detectionFilter: sensing });
    fire("refreshToken", located, {});
    const marks = layer.children[0].children;
    const first = marks.at(-1);
    expect(first.destroyed).toBeUndefined();
    located.detectionFilter = hearing;
    fire("refreshToken", located, {});
    expect(first.destroyed).toBe(true);
    expect(marks.at(-1)).not.toBe(first);
    located.detectionFilter = null;
    fire("refreshToken", located, {});
    expect(marks.at(-1).destroyed).toBe(true);
  });
  it("`anonymousLocated` setting: the image, name, bars and conditions of a heard token are removed, then restored", () => {
    const flags = [];
    const heard = tokenOf("anon", { detectionFilter: hearing });
    heard.visible = true;
    Object.assign(heard, { w: 100, h: 100, mesh: { visible: true }, nameplate: { visible: true }, bars: { visible: true },
      effects: { visible: true }, border: { visible: true }, renderFlags: { set: f => flags.push(f) } });
    heard.constructor = { RENDER_FLAGS: { refreshState: {}, refreshBars: {}, refreshNameplate: {} } };
    // Off: nothing is touched.
    fire("refreshToken", heard, {});
    expect(heard.mesh.visible).toBe(true);
    expect(heard.nameplate.visible).toBe(true);
    // On: anonymous at each refresh (the core puts the image back in between).
    anonymous = true;
    fire("refreshToken", heard, {});
    expect(heard.mesh.visible).toBe(false);
    expect([heard.nameplate.visible, heard.bars.visible, heard.effects.visible]).toEqual([false, false, false]);
    expect(heard.border.visible).toBe(false);
    // The core's default silhouette, at the token's size, under the hearing outline.
    const stand = layer.children[0].children.at(-1).children.find(child => child.filters);
    expect(stand.visible).toBe(true);
    expect([stand.width, stand.height]).toEqual([100, 100]);
    expect(stand.filters).toEqual([hearing]);
    heard.mesh.visible = true;
    fire("refreshToken", heard, {});
    expect(heard.mesh.visible).toBe(false);
    expect(flags).toHaveLength(0);
    // It is seen normally: the core redraws everything, by the flags it knows.
    heard.detectionFilter = null;
    fire("refreshToken", heard, {});
    expect(flags).toEqual([{ refreshState: true, refreshNameplate: true, refreshBars: true }]);
    expect([heard.nameplate.visible, heard.bars.visible, heard.effects.visible]).toEqual([true, true, true]);
    expect(heard.mesh.visible).toBe(true);
    // A seen token, never anonymous: no flag requested.
    const seen = tokenOf("plain");
    seen.renderFlags = { set: f => flags.push(f) };
    fire("refreshToken", seen, {});
    expect(flags).toHaveLength(1);
    anonymous = false;
  });
});
