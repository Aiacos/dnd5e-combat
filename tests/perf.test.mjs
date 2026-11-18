import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPerf } from "../module/scripts/core/perf.mjs";
import { createRouter } from "../module/scripts/runtime/router.mjs";

describe("relevé des temps (§98)", () => {
  it("cumule par inscrit, trie par temps synchrone, signale au-delà du seuil", () => {
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

  it("le routeur chronomètre le temps synchrone, et la fin d'une promesse à part", async () => {
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

  it("une erreur synchrone est quand même chronométrée", () => {
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
 * Issue #49 : la ligne « slow: » est une mesure, pas une erreur. Le débogueur (runtime/debug.mjs) relève tout `console.warn`
 * préfixé par l'identifiant du module : écrite en avertissement, la ligne levait l'avis « DAS a relevé une erreur » à chaque
 * chargement, chez le MJ comme chez les joueurs.
 */
describe("ligne « slow: » et débogueur (issue #49)", () => {
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

  it("un inscrit lent écrit sa ligne en console sans être relevé comme une erreur", () => {
    const heard = [];
    const off = debug.debugApi.onError((group, isNew) => heard.push([group.kind, group.message, isNew]));
    perf.recordTiming("ready", "issue 49 : audit du contenu", "sync", 52);   // seuil par défaut : 50 ms
    off();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatch(/^dnd5e-combat \| slow: ready "issue 49 : audit du contenu" 52 ms/);
    expect(heard).toEqual([]);
    expect(debug.debugApi.total("suite")).toBe(0);
  });

  it("un vrai avertissement du module reste relevé", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    debug.uninstallCapture();
    debug.installCapture({ console: globalThis.console, addEventListener() {}, removeEventListener() {} });
    console.warn("dnd5e-combat | quelque chose a échoué");
    expect(debug.debugApi.total("suite")).toBe(1);
    debug.uninstallCapture();
    warn.mockRestore();
  });
});
