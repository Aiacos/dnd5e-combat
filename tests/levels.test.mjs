import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEVELS, DEFAULT_LEVEL, atLeast, levelRank, featureLevel, FEATURE_LEVELS } from "../module/scripts/core/levels.mjs";
import { createRouter } from "../module/scripts/runtime/router.mjs";

const entry = readFileSync(new URL("../module/scripts/dnd5e-combat.mjs", import.meta.url), "utf8");

describe("niveaux d'automatisation (§117)", () => {
  it("three ordered levels, Full by default", () => {
    expect(LEVELS).toEqual(["essentials", "assisted", "full"]);
    expect(DEFAULT_LEVEL).toBe("full");
    expect(atLeast("full", "assisted")).toBe(true);
    expect(atLeast("assisted", "full")).toBe(false);
    expect(atLeast("essentials", "essentials")).toBe(true);
    expect(levelRank("inconnu")).toBe(levelRank("full"));
  });

  it("every entry-point function goes through gated() and has its level in the table", () => {
    const raw = Array.from(entry.matchAll(/^\s*(register[A-Z]\w*)\(\);/gm), m => m[1]).filter(n => !["registerLevel", "registerWelcome", "registerDebug", "registerConnection"].includes(n));   // §177: welcome, §380: debugger, §388: connection, outside levels (declared even when dormant)
    expect(raw, "appelées sans gated()").toEqual([]);
    const gatedNames = Array.from(entry.matchAll(/gated\((register[A-Z]\w*)\)/g), m => m[1]);
    expect(gatedNames.length).toBeGreaterThan(90);
    expect(gatedNames.filter(n => !(n in FEATURE_LEVELS)), "absentes de FEATURE_LEVELS").toEqual([]);
    expect(Object.keys(FEATURE_LEVELS).filter(n => !gatedNames.includes(n)), "dans la table mais pas au point d'entrée").toEqual([]);
  });

  it("the level is declared before any other function", () => {
    const init = entry.slice(entry.indexOf("Hooks.once(\"init\""));
    expect(init.indexOf("registerLevel()")).toBeGreaterThan(0);
    expect(init.indexOf("registerLevel()")).toBeLessThan(init.indexOf("gated("));
  });

  it("the interface foundation is at the Essential level, resolution at Assisted, content at Full", () => {
    for ( const n of ["registerActions", "registerPointer", "registerTurn", "registerVision", "registerTracker"] ) expect(featureLevel(n), n).toBe("essentials");
    for ( const n of ["registerEngine", "registerConditions", "registerConcentration", "registerDeath"] ) expect(featureLevel(n), n).toBe("assisted");
    for ( const n of ["registerAuras", "registerSneak", "registerSmite", "registerWildShape"] ) expect(featureLevel(n), n).toBe("full");
    expect(featureLevel("registerInconnue")).toBe("full");
  });
});

describe("routeur : withoutRoutes", () => {
  it("a function launched without its listeners hooks nothing, and what it asked for can be read", () => {
    const subscribed = [];
    const router = createRouter({ subscribe: hook => subscribed.push(hook), isExecutor: () => true, report: () => {} });
    let ran = false;
    router.withoutRoutes("registerAuras", () => { ran = true; router.on("updateToken", () => {}, { label: "auras" }); });
    router.on("createToken", () => {}, { label: "autre" });
    expect(ran).toBe(true);
    expect(subscribed).toEqual(["createToken"]);
    expect(router.skipped()).toEqual([{ hook: "updateToken", label: "auras", feature: "registerAuras" }]);
    expect(Object.keys(router.describe())).toEqual(["createToken"]);
  });

  it("after withoutRoutes, registrations resume normally, even if the function threw an error", () => {
    const subscribed = [];
    const router = createRouter({ subscribe: hook => subscribed.push(hook), isExecutor: () => true, report: () => {} });
    expect(() => router.withoutRoutes("x", () => { throw new Error("boom"); })).toThrow("boom");
    router.on("ready", () => {});
    expect(subscribed).toEqual(["ready"]);
  });
});
