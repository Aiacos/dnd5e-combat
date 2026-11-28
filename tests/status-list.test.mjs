/**
 * Facts `target.hasStatus` and `source.hasStatus`: one condition, or any of a list — the form given by the header of
 * core/triggers.mjs. Generic example: a bite that only applies against a Grappled, Incapacitated or Restrained creature.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { holds } from "../module/scripts/core/triggers.mjs";

describe("hasStatus: one condition or any of a list", () => {
  let factsFor;
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    await import("../module/scripts/adapter/running-water.mjs");   // same load order as armor-facts.test.mjs
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });

  const bound = { statuses: new Set(["restrained"]) };
  const free = { statuses: new Set() };
  const three = ["grappled", "incapacitated", "restrained"];

  it("a single condition, as before", () => {
    expect(holds({ "target.hasStatus": "restrained" }, factsFor({ target: bound }))).toBe(true);
    expect(holds({ "target.hasStatus": "prone" }, factsFor({ target: bound }))).toBe(false);
    expect(holds({ "source.hasStatus": "restrained" }, factsFor({ source: bound }))).toBe(true);
  });
  it("a list: true as soon as the creature has any of the conditions", () => {
    expect(holds({ "target.hasStatus": three }, factsFor({ target: bound }))).toBe(true);
    expect(holds({ "target.hasStatus": three }, factsFor({ target: free }))).toBe(false);
    expect(holds({ "source.hasStatus": three }, factsFor({ source: bound }))).toBe(true);
    expect(holds({ "target.hasStatus": [] }, factsFor({ target: bound }))).toBe(false);
  });
  it("under `not`: \"only applies against a creature that has any of these conditions\"", () => {
    expect(holds({ not: { "target.hasStatus": three } }, factsFor({ target: free }))).toBe(true);
    expect(holds({ not: { "target.hasStatus": three } }, factsFor({ target: bound }))).toBe(false);
  });
  it("without a creature: false", () => {
    expect(holds({ "target.hasStatus": three }, factsFor({}))).toBe(false);
  });
});
