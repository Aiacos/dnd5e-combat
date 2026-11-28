/** §474: DDB Importer's Arcane Ward absorbed a second time — its automations turned off (adapter/interop.mjs), on a fake world. */
import { describe, it, expect, afterEach } from "vitest";

const { foreignEnhancers, disarmForeignEnhancers } = await import("../module/scripts/adapter/interop.mjs");

const KEYS = ["allow-arcane-ward-enhancer", "allow-warding-bond-enhancer"];

/** A world where DDB Importer is `active`, its settings declared `declared` (or later, by `declareLater()`), holding `values`. */
function world({ active=true, declared=true, values={} }={}) {
  const store = new Map(KEYS.map(k => [`ddb-importer.${k}`, values[k] ?? true]));
  const settings = new Map(declared ? [...store.keys()].map(k => [k, {}]) : []);
  globalThis.game = {
    modules: new Map([["ddb-importer", { active }]]),
    settings: {
      settings,
      get: (ns, key) => { if ( !settings.has(`${ns}.${key}`) ) throw new Error("not registered"); return store.get(`${ns}.${key}`); },
      set: async (ns, key, value) => { store.set(`${ns}.${key}`, value); return value; }
    }
  };
  return { store, declareLater: () => { for ( const k of store.keys() ) settings.set(k, {}); } };
}

afterEach(() => { delete globalThis.game; });

describe("DDB Importer: Arcane Ward and Protective Bond", () => {
  it("its two active automations (default value) are turned off", async () => {
    const { store } = world();
    expect(foreignEnhancers()).toEqual(KEYS);
    expect(await disarmForeignEnhancers({ waitMs: 0 })).toEqual(KEYS);
    expect([...store.values()]).toEqual([false, false]);
    expect(foreignEnhancers()).toEqual([]);
  });

  it("already turned off: nothing to do, nothing to announce", async () => {
    world({ values: { "allow-arcane-ward-enhancer": false, "allow-warding-bond-enhancer": false } });
    expect(await disarmForeignEnhancers({ waitMs: 0 })).toEqual([]);
  });

  it("DDB Importer inactive: nothing is touched", async () => {
    const { store } = world({ active: false });
    expect(await disarmForeignEnhancers({ waitMs: 0 })).toEqual([]);
    expect([...store.values()]).toEqual([true, true]);
  });

  it("settings declared after the engine's `ready`: we wait for them, then turn them off", async () => {
    const { store, declareLater } = world({ declared: false });
    expect(foreignEnhancers()).toEqual([]);
    setTimeout(declareLater, 20);
    expect(await disarmForeignEnhancers({ waitMs: 2000, stepMs: 5 })).toEqual(KEYS);
    expect([...store.values()]).toEqual([false, false]);
  });
});
