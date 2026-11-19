/** §474 : l'Égide arcanique de DDB Importer absorbait une seconde fois — ses automatismes coupés (adapter/interop.mjs), sur un faux monde. */
import { describe, it, expect, afterEach } from "vitest";

const { foreignEnhancers, disarmForeignEnhancers } = await import("../module/scripts/adapter/interop.mjs");

const KEYS = ["allow-arcane-ward-enhancer", "allow-warding-bond-enhancer"];

/** Un monde où DDB Importer est `active`, ses réglages déclarés `declared` (ou plus tard, par `declareLater()`), valant `values`. */
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

describe("DDB Importer : Égide arcanique et Lien protecteur", () => {
  it("ses deux automatismes actifs (valeur par défaut) sont coupés", async () => {
    const { store } = world();
    expect(foreignEnhancers()).toEqual(KEYS);
    expect(await disarmForeignEnhancers({ waitMs: 0 })).toEqual(KEYS);
    expect([...store.values()]).toEqual([false, false]);
    expect(foreignEnhancers()).toEqual([]);
  });

  it("déjà coupés : rien à faire, rien à annoncer", async () => {
    world({ values: { "allow-arcane-ward-enhancer": false, "allow-warding-bond-enhancer": false } });
    expect(await disarmForeignEnhancers({ waitMs: 0 })).toEqual([]);
  });

  it("DDB Importer inactif : rien n'est touché", async () => {
    const { store } = world({ active: false });
    expect(await disarmForeignEnhancers({ waitMs: 0 })).toEqual([]);
    expect([...store.values()]).toEqual([true, true]);
  });

  it("réglages déclarés après le `ready` du moteur : on les attend, puis on les coupe", async () => {
    const { store, declareLater } = world({ declared: false });
    expect(foreignEnhancers()).toEqual([]);
    setTimeout(declareLater, 20);
    expect(await disarmForeignEnhancers({ waitMs: 2000, stepMs: 5 })).toEqual(KEYS);
    expect([...store.values()]).toEqual([false, false]);
  });
});
