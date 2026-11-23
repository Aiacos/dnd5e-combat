/**
 * Faits `target.hasStatus` et `source.hasStatus` : un état, ou l'un d'une liste — la forme que donne l'en-tête de core/triggers.mjs.
 * Exemple générique : une morsure qui ne vaut que contre une créature Agrippée, Neutralisée ou Entravée.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("hasStatus : un état ou l'un d'une liste", () => {
  let factsFor;
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    await import("../module/scripts/adapter/running-water.mjs");   // même ordre de chargement que armor-facts.test.mjs
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });

  const bound = { statuses: new Set(["restrained"]) };
  const free = { statuses: new Set() };
  const three = ["grappled", "incapacitated", "restrained"];

  it("un seul état, comme avant", () => {
    expect(holds({ "target.hasStatus": "restrained" }, factsFor({ target: bound }))).toBe(true);
    expect(holds({ "target.hasStatus": "prone" }, factsFor({ target: bound }))).toBe(false);
    expect(holds({ "source.hasStatus": "restrained" }, factsFor({ source: bound }))).toBe(true);
  });
  it("une liste : vrai dès que la créature a l'un des états", () => {
    expect(holds({ "target.hasStatus": three }, factsFor({ target: bound }))).toBe(true);
    expect(holds({ "target.hasStatus": three }, factsFor({ target: free }))).toBe(false);
    expect(holds({ "source.hasStatus": three }, factsFor({ source: bound }))).toBe(true);
    expect(holds({ "target.hasStatus": [] }, factsFor({ target: bound }))).toBe(false);
  });
  it("sous `not` : « ne vaut que contre une créature qui a l'un de ces états »", () => {
    expect(holds({ not: { "target.hasStatus": three } }, factsFor({ target: free }))).toBe(true);
    expect(holds({ not: { "target.hasStatus": three } }, factsFor({ target: bound }))).toBe(false);
  });
  it("sans créature : faux", () => {
    expect(holds({ "target.hasStatus": three }, factsFor({}))).toBe(false);
  });
});
