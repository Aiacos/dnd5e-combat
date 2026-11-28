/** §272: timers above the tokens — what can be computed without Foundry. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { TIMER_GRADIENT, timerSecondsText, timerState } from "../module/scripts/core/timers.mjs";

describe("minuteries", () => {
  it("avance, secondes restantes arrondies au-dessus, fin", () => {
    expect(timerState({ startedAt: 1000, seconds: 5 }, 1000)).toEqual({ pct: 0, left: 5, done: false });
    expect(timerState({ startedAt: 1000, seconds: 5 }, 3600)).toEqual({ pct: 0.52, left: 3, done: false });
    expect(timerState({ startedAt: 1000, seconds: 5 }, 9000)).toEqual({ pct: 1, left: 0, done: true });
    expect(timerState({ startedAt: 1000, seconds: 0 }, 1000).done).toBe(true);
  });
  it("seconds are written, unless the table hides them", () => {
    expect(timerSecondsText(4)).toBe("4 s");
    expect(timerSecondsText(4, { hideSeconds: true })).toBe("");
  });
  it("the DAS logo gradient", () => {
    expect(TIMER_GRADIENT).toEqual(["#e005f4", "#ee0388", "#fc0016"]);
  });
});

/** The bare minimum of Foundry and PIXI to run `ui/timers.mjs`: a token, a ticker, inert drawings. */
function fakeCanvas() {
  const state = { tick: null, present: true };
  const scene = {};
  const document = { id: "tok1", uuid: "Scene.s.Token.tok1", parent: scene };
  const token = { destroyed: false, document, isVisible: true, center: { x: 0, y: 0 }, y: 0 };
  class Node {
    position = { set() {} }; anchor = { set() {} }; width = 10; height = 10; rotation = 0;
    addChild(...children) { return children[0]; }
    destroy() {}
    beginFill() { return this; }
    endFill() { return this; }
    drawRoundedRect() { return this; }
    lineStyle() { return this; }
  }
  const gradient = { addColorStop() {} };
  vi.stubGlobal("PIXI", { Container: Node, Graphics: Node, Text: Node, Sprite: Node, Texture: { from: () => ({}) } });
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ createLinearGradient: () => gradient, fillRect() {} }) }) });
  const canvas = { ready: true, scene, grid: { size: 100 },
    app: { ticker: { add: fn => { state.tick = fn; }, remove: () => { state.tick = null; } } },
    tokens: { get: id => ((state.present && (id === "tok1")) ? token : null) } };
  canvas.interface = { addChild: child => { child.parent = canvas.interface; return child; } };
  vi.stubGlobal("canvas", canvas);
  vi.stubGlobal("game", { users: [], settings: { get: () => false }, i18n: { localize: k => k, format: k => k } });
  vi.stubGlobal("CONFIG", { queries: {} });
  vi.stubGlobal("foundry", { utils: { randomID: () => "id1" } });
  vi.stubGlobal("fromUuidSync", uuid => ((uuid === document.uuid) ? document : null));
  return { state, uuid: document.uuid };
}

describe("drawn timer (ui)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("ends on time even if its token is no longer there", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { state, uuid } = fakeCanvas();
    const { startTimer } = await import("../module/scripts/ui/timers.mjs");
    const timer = startTimer({ token: uuid, seconds: 2 });
    let done = false;
    timer.done.then(() => { done = true; });
    state.tick({ deltaTime: 1 });
    state.present = false;                 // the token is deleted (or this client changes scene)
    vi.advanceTimersByTime(60_000);
    state.tick?.({ deltaTime: 1 });
    await Promise.resolve();
    expect(done).toBe(true);
    expect(state.tick).toBe(null);         // nothing left to animate: the ticker is released
  });
});
