import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPerf } from "../module/scripts/core/perf.mjs";
import { createRouter } from "../module/scripts/runtime/router.mjs";

describe("timing survey (§98)", () => {
  it("accumulates per registrant, sorts by synchronous time, flags above the threshold", () => {
    const slow = [];
    const perf = createPerf({ threshold: 50, onSlow: (row, ms) => slow.push([row.label, ms]) });
    perf.record("h", "a", "sync", 10);
    perf.record("h", "a", "sync", 70);
    perf.record("h", "b", "sync", 5);
    perf.record("h", "b", "async", 2000);
    const [a, b] = perf.report();
    expect(a).toMatchObject({ label: "a", calls: 2, totalMs: 80, avgMs: 40, maxMs: 70, slow: 1 });
    expect(b).toMatchObject({ label: "b", calls: 1, asyncMaxMs: 2000, slow: 0 });
    expect(slow).toEqual([["a", 70]]);
    perf.setThreshold(0);
    perf.record("h", "a", "sync", 900);
    expect(slow).toHaveLength(1);
    perf.reset();
    expect(perf.report()).toEqual([]);
  });

  it("the router times the synchronous part, and the end of a promise separately", async () => {
    let clock = 0;
    const seen = [];
    const handlers = {};
    const router = createRouter({ subscribe: (hook, fn) => { handlers[hook] = fn; }, isExecutor: () => true, report: () => {},
      timing: { now: () => clock, record: (hook, label, kind, ms) => seen.push([label, kind, ms]) } });
    router.on("h", () => { clock += 30; }, { label: "sync" });
    let release;
    router.on("h", () => { clock += 5; return new Promise(r => { release = r; }); }, { label: "async" });
    handlers.h();
    expect(seen).toEqual([["sync", "sync", 30], ["async", "sync", 5]]);
    clock += 1000;
    release();
    await new Promise(r => setTimeout(r, 0));
    expect(seen[2]).toEqual(["async", "async", 1005]);
  });

  it("a synchronous error is timed all the same", () => {
    const seen = [];
    const handlers = {};
    const router = createRouter({ subscribe: (hook, fn) => { handlers[hook] = fn; }, isExecutor: () => true, report: () => {},
      timing: { now: () => 0, record: (hook, label, kind) => seen.push([label, kind]) } });
    router.on("h", () => { throw new Error("x"); }, { label: "boum" });
    handlers.h();
    expect(seen).toEqual([["boum", "sync"]]);
  });
});

/**
 * Issue #49: the "slow:" line is a measurement, not an error. The debugger (runtime/debug.mjs) picks up every `console.warn`
 * prefixed with the module id: written as a warning, the line raised the "DAS caught an error" notice at every load,
 * for the GM as well as for the players.
 */
describe("\"slow:\" line and debugger (issue #49)", () => {
  let debug, perf, info;
  beforeEach(async () => {
    debug = await import("../module/scripts/runtime/debug.mjs");
    perf = await import("../module/scripts/runtime/perf.mjs");
    const modules = [{ id: "dnd5e-combat", title: "DAS · Core", active: true }];
    globalThis.game = { user: { id: "u-joueur" }, modules: Object.assign(modules, { get: id => modules.find(m => m.id === id) }) };
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    debug.uninstallCapture();
    debug.installCapture({ console: globalThis.console, addEventListener() {}, removeEventListener() {} });
    debug.debugApi.clear();
  });
  afterEach(() => {
    debug.uninstallCapture();
    info.mockRestore();
    delete globalThis.game;
  });

  it("a slow registrant writes its line to the console without being flagged as an error", () => {
    const heard = [];
    const off = debug.debugApi.onError((group, isNew) => heard.push([group.kind, group.message, isNew]));
    perf.recordTiming("ready", "issue 49 : audit du contenu", "sync", 52);   // default threshold: 50 ms
    off();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatch(/^dnd5e-combat \| slow: ready "issue 49 : audit du contenu" 52 ms/);
    expect(heard).toEqual([]);
    expect(debug.debugApi.total("suite")).toBe(0);
  });

  it("a real module warning is still flagged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    debug.uninstallCapture();
    debug.installCapture({ console: globalThis.console, addEventListener() {}, removeEventListener() {} });
    console.warn("dnd5e-combat | quelque chose a échoué");
    expect(debug.debugApi.total("suite")).toBe(1);
    debug.uninstallCapture();
    warn.mockRestore();
  });
});
