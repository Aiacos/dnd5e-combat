/**
 * §493 (B13) : réaction contre une zone (Bouclier d'insectes) — fait `activity.areaShape`, moment `inArea`, étape `cancelForSelf`
 * (`ifSourceFails`). Exemple générique : une créature qui, prise dans un cône ou une ligne, impose une sauvegarde au lanceur.
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
  it("une réaction de zone qui impose une sauvegarde à la source : valide", () => {
    expect(validateEntry(SHIELD, { facts })).toEqual([]);
  });
  it("sans condition sur la source, d'office : valide", () => {
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use" }, { type: "cancelForSelf" }] }] }, { facts })).toEqual([]);
  });
  it("`cancelForSelf` hors de `inArea`, ou sans réaction `use` : refusé", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "cancelForSelf" }] }] }, { facts }).join())
      .toMatch(/cancelForSelf" requires the inArea moment/);
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "cancelForSelf" }] }] }, { facts }).join())
      .toMatch(/cancelForSelf" requires the inArea moment and a "use" reaction/);
  });
  it("`ifSourceFails` : vrai ou absent, et une réaction qui vise la source", () => {
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use", target: "source" }, { type: "cancelForSelf", ifSourceFails: "yes" }] }] }, { facts }).join())
      .toMatch(/ifSourceFails: true or absent/);
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use" }, { type: "cancelForSelf", ifSourceFails: true }] }] }, { facts }).join())
      .toMatch(/target: "source"/);
    expect(validateEntry({ triggers: [{ on: "inArea", do: [{ type: "use", target: "source" }, { type: "cancelForSelf", half: true }] }] }, { facts }).join())
      .toMatch(/unknown key half/);
  });
  it("un fait inconnu dans la condition : refusé", () => {
    expect(validateEntry({ triggers: [{ on: "inArea", if: { "activity.areaForm": "cone" }, do: [{ type: "use" }, { type: "cancelForSelf" }] }] }, { facts }).join())
      .toMatch(/unknown fact "activity.areaForm"/);
  });
});

describe("§493 : forme de la zone et issue", () => {
  it("la forme se lit sur `target.template.type`, null sans zone", () => {
    expect(areaShapeOf({ target: { template: { type: "cone" } } })).toBe("cone");
    expect(areaShapeOf({ target: { template: { type: "" } } })).toBe(null);
    expect(areaShapeOf({ target: {} })).toBe(null);
    expect(areaShapeOf(null)).toBe(null);
  });
  it("la condition « cône ou ligne » tient pour un cône, pas pour une sphère ni sans zone", () => {
    const at = shape => holds(SHIELD.triggers[0].if, { "activity.isSpell": true, "activity.areaShape": shape });
    expect(at("cone")).toBe(true);
    expect(at("line")).toBe(true);
    expect(at("sphere")).toBe(false);
    expect(at(null)).toBe(false);
  });
  it("épargnée : réaction prise, et sauvegarde de la source ratée quand elle est exigée", () => {
    expect(sparedFromArea({ taken: false })).toBe(false);
    expect(sparedFromArea({ taken: true })).toBe(true);
    expect(sparedFromArea({ taken: true, ifSourceFails: true, sourceSave: { success: false } })).toBe(true);
    expect(sparedFromArea({ taken: true, ifSourceFails: true, sourceSave: { success: true } })).toBe(false);
    expect(sparedFromArea({ taken: true, ifSourceFails: true, sourceSave: null })).toBe(false);   // sauvegarde illisible : les dégâts passent
  });
});

describe("§493 : le fait `activity.areaShape` dans `factsFor`", () => {
  let factsFor;
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    await import("../module/scripts/adapter/running-water.mjs");   // même ordre que self-facts.test.mjs (imports circulaires)
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });
  it("connu sans activité (validation du contenu), et lu sur l'activité", () => {
    expect("activity.areaShape" in factsFor()).toBe(true);
    expect(factsFor()["activity.areaShape"]).toBe(null);
    expect(factsFor({ activity: { type: "save", target: { template: { type: "line" } } } })["activity.areaShape"]).toBe("line");
  });
});
