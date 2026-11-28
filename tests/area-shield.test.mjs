/**
 * §493 (B13): reaction against an area (Insect Shield) — fact `activity.areaShape`, moment `inArea`, step `cancelForSelf`
 * (`ifSourceFails`). Generic example: a creature that, caught in a Cone or a Line, imposes a saving throw on the caster.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { MOMENTS, holds } from "../module/scripts/core/triggers.mjs";
import { areaShapeOf, sparedFromArea } from "../module/scripts/core/area-shield.mjs";

const facts = Object.fromEntries(["activity.isSpell", "activity.areaShape"].map(k => [k, true]));

const SHIELD = { triggers: [{ on: "inArea", if: { "activity.isSpell": true, "activity.areaShape": ["cone", "line"] },
  do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: true }] }] };

describe("§493 : validation", () => {
  it("le moment `inArea` existe", () => {
    expect(Object.keys(MOMENTS)).toContain("inArea");
  });
  it("an area reaction that imposes a saving throw on the source: valid", () => {
    expect(validateEntry(SHIELD, { facts })).toEqual([]);
  });
  it("with no condition on the source, automatic: valid", () => {
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use" }, { type: "cancelForSelf" }] }] }, { facts })).toEqual([]);
  });
  it("`cancelForSelf` outside `inArea`, or without a `use` reaction: refused", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "cancelForSelf" }] }] }, { facts }).join())
      .toMatch(/cancelForSelf" requires the inArea moment/);
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "cancelForSelf" }] }] }, { facts }).join())
      .toMatch(/cancelForSelf" requires the inArea moment and a "use" reaction/);
  });
  it("`ifSourceFails`: true or absent, and a reaction that targets the source", () => {
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: "yes" }] }] }, { facts }).join())
      .toMatch(/ifSourceFails: true or absent/);
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use" }, { type: "cancelForSelf", ifSourceFails: true }] }] }, { facts }).join())
      .toMatch(/target: "source"/);
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use", target: "source" }, { type: "cancelForSelf", half: true }] }] }, { facts }).join())
      .toMatch(/unknown key half/);
  });
  it("an unknown fact in the condition: refused", () => {
    expect(validateEntry({ triggers: [{ on: "inArea", if: { "activity.areaForm": "cone" }, do: [{ type: "use" }, { type: "cancelForSelf" }] }] }, { facts }).join())
      .toMatch(/unknown fact "activity.areaForm"/);
  });
});

describe("§493 : forme de la zone et issue", () => {
  it("the shape is read from `target.template.type`, null without an area", () => {
    expect(areaShapeOf({ target: { template: { type: "cone" } } })).toBe("cone");
    expect(areaShapeOf({ target: { template: { type: "" } } })).toBe(null);
    expect(areaShapeOf({ target: {} })).toBe(null);
    expect(areaShapeOf(null)).toBe(null);
  });
  it("the \"Cone or Line\" condition holds for a Cone, not for a Sphere or without an area", () => {
    const at = shape => holds(SHIELD.triggers[0].if, { "activity.isSpell": true, "activity.areaShape": shape });
    expect(at("cone")).toBe(true);
    expect(at("line")).toBe(true);
    expect(at("sphere")).toBe(false);
    expect(at(null)).toBe(false);
  });
  it("spared: reaction taken, and the source's saving throw failed when it is required", () => {
    expect(sparedFromArea({ taken: false })).toBe(false);
    expect(sparedFromArea({ taken: true })).toBe(true);
    expect(sparedFromArea({ taken: true, ifSourceFails: true, sourceSave: { success: false } })).toBe(true);
    expect(sparedFromArea({ taken: true, ifSourceFails: true, sourceSave: { success: true } })).toBe(false);
    expect(sparedFromArea({ taken: true, ifSourceFails: true, sourceSave: null })).toBe(false);   // unreadable save: the damage goes through
  });
});

describe("§493: the fact `activity.areaShape` in `factsFor`", () => {
  let factsFor;
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    await import("../module/scripts/adapter/running-water.mjs");   // same order as self-facts.test.mjs (circular imports)
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });
  it("known without an activity (content validation), and read from the activity", () => {
    expect("activity.areaShape" in factsFor()).toBe(true);
    expect(factsFor()["activity.areaShape"]).toBe(null);
    expect(factsFor({ activity: { type: "save", target: { template: { type: "line" } } } })["activity.areaShape"]).toBe("line");
  });
});
