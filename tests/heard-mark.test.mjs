/**
 * Issue #42 : l'oreille des créatures entendues (ui/perception.mjs, `refreshMark`) se décide à chaque `refreshToken` et
 * `hoverToken` de chaque token. `Token#isVisible` relance le test de visibilité entier du cœur à chaque lecture : tant que ce
 * client n'a rien entendu (le filtre de l'ouïe n'existe pas encore), aucun token ne peut être « entendu » et le test n'a pas à
 * être refait.
 */
import { describe, it, expect, beforeAll } from "vitest";

const hooks = {};
const fire = (hook, ...args) => hooks[hook].forEach(fn => fn(...args));
const layer = { children: [], addChild(child) { child.parent = layer; layer.children.push(child); return child; } };
const hearing = { name: "le filtre de l'ouïe" };
const sensing = { name: "le filtre des sens déclarés" };
let anonymous = false;   // le réglage `anonymousLocated` du monde

/** Un token du canevas ; `tests` compte les lectures de `isVisible` (un test de visibilité du cœur chacune). */
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
  // Ce que `buildMark` dessine : des conteneurs PIXI sans rendu.
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

describe("issue #42 : l'oreille des créatures entendues", () => {
  it("tant que rien n'a été entendu sur ce client : pas d'oreille, et aucun test de visibilité relancé", () => {
    const tokens = Array.from({ length: 40 }, (_, n) => tokenOf(`t${n}`));
    for ( const token of tokens ) fire("refreshToken", token, {});
    for ( const token of tokens ) fire("hoverToken", token, true);
    expect(layer.children).toHaveLength(0);
    expect(tokens.reduce((sum, token) => sum + token.tests, 0)).toBe(0);
  });

  it("une fois le filtre de l'ouïe créé : l'oreille sur le token entendu et visible, pas sur les autres — comme avant", () => {
    fire("setup");
    // Le cœur demande son filtre au mode de l'ouïe pour le premier token entendu.
    expect(CONFIG.Canvas.detectionModes.dasHearing.constructor.getDetectionFilter()).toBe(hearing);
    const heard = tokenOf("heard", { detectionFilter: hearing });
    const seen = tokenOf("seen");                                           // vu normalement : aucun filtre
    const other = tokenOf("other", { detectionFilter: { name: "un autre contour" } });   // perception des vibrations…
    const gone = tokenOf("gone", { visible: false, detectionFilter: hearing });          // plus affiché
    for ( const token of [heard, seen, other, gone] ) fire("refreshToken", token, {});
    const marks = layer.children[0].children;
    expect(marks).toHaveLength(1);
    expect(marks[0].position.x).toBeCloseTo(heard.x + (13 * 0.6));   // coin haut gauche, rayon de 13 px pour une case de 100
    expect(marks[0].position.y).toBeCloseTo(heard.y + (13 * 0.6));
    expect(heard.tests).toBe(1);
    // Il n'est plus entendu : l'oreille part.
    heard.detectionFilter = null;
    fire("refreshToken", heard, {});
    expect(marks[0].destroyed).toBe(true);
  });

  it("une créature localisée par un sens déclaré : sa propre marque, remplacée si elle n'est plus qu'entendue", () => {
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
  it("réglage `anonymousLocated` : l'image, le nom, les barres et les états d'un token entendu sont retirés, puis rendus", () => {
    const flags = [];
    const heard = tokenOf("anon", { detectionFilter: hearing });
    heard.visible = true;
    Object.assign(heard, { w: 100, h: 100, mesh: { visible: true }, nameplate: { visible: true }, bars: { visible: true },
      effects: { visible: true }, border: { visible: true }, renderFlags: { set: f => flags.push(f) } });
    heard.constructor = { RENDER_FLAGS: { refreshState: {}, refreshBars: {}, refreshNameplate: {} } };
    // Éteint : rien n'est touché.
    fire("refreshToken", heard, {});
    expect(heard.mesh.visible).toBe(true);
    expect(heard.nameplate.visible).toBe(true);
    // Allumé : anonyme à chaque rafraîchissement (le cœur remet l'image entre-temps).
    anonymous = true;
    fire("refreshToken", heard, {});
    expect(heard.mesh.visible).toBe(false);
    expect([heard.nameplate.visible, heard.bars.visible, heard.effects.visible]).toEqual([false, false, false]);
    expect(heard.border.visible).toBe(false);
    // La silhouette par défaut du cœur, à la taille du token, sous le contour de l'ouïe.
    const stand = layer.children[0].children.at(-1).children.find(child => child.filters);
    expect(stand.visible).toBe(true);
    expect([stand.width, stand.height]).toEqual([100, 100]);
    expect(stand.filters).toEqual([hearing]);
    heard.mesh.visible = true;
    fire("refreshToken", heard, {});
    expect(heard.mesh.visible).toBe(false);
    expect(flags).toHaveLength(0);
    // Il est vu normalement : le cœur redessine tout, par les drapeaux qu'il connaît.
    heard.detectionFilter = null;
    fire("refreshToken", heard, {});
    expect(flags).toEqual([{ refreshState: true, refreshNameplate: true, refreshBars: true }]);
    expect([heard.nameplate.visible, heard.bars.visible, heard.effects.visible]).toEqual([true, true, true]);
    expect(heard.mesh.visible).toBe(true);
    // Un token vu, jamais anonyme : aucun drapeau demandé.
    const seen = tokenOf("plain");
    seen.renderFlags = { set: f => flags.push(f) };
    fire("refreshToken", seen, {});
    expect(flags).toHaveLength(1);
    anonymous = false;
  });
});
