/**
 * §484 : faits sur la créature elle-même (`self.inSunlight`, `self.inBrightLight`, `self.inRunningWater`), dégâts qu'un trait inflige à
 * son porteur au début de son tour (`to: "self"`, sans effet posé) et Désavantage déclaré aux tests (`rollDisadvantage`). Exemple
 * générique : une créature qui brûle au soleil.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { validateEntry } from "../module/scripts/core/content.mjs";

const facts = Object.fromEntries(["self.inSunlight", "self.inBrightLight", "self.inRunningWater", "source.inSunlight", "target.atZero"]
  .map(k => [k, () => true]));

const BURNS = {
  triggers: [{ on: "startOfTurn", if: { "self.inSunlight": true }, do: [{ type: "damage", to: "self", formula: "20", damageType: "radiant" }] }],
  rollDisadvantage: { on: ["check"], if: { "self.inSunlight": true } }
};

describe("§484 : validation", () => {
  it("un trait qui brûle son porteur au début de son tour, et le Désavantage aux tests : valides", () => {
    expect(validateEntry(BURNS, { facts })).toEqual([]);
  });
  it("`to: \"self\"` : à son tour seulement, porté par l'item lui-même", () => {
    const at = (on, extra={}) => validateEntry({ triggers: [{ on, ...extra, do: [{ type: "damage", to: "self", formula: "1d6", damageType: "fire" }] }] }, { facts });
    expect(at("endOfTurn")).toEqual([]);
    expect(at("isHit").join()).toMatch(/to: "self"/);
    expect(at("startOfTurn", { via: "effect" }).join()).toMatch(/to: "self"/);
  });
  it("`to: \"self\"` peut rejouer l'activité de dégâts de l'item", () => {
    expect(validateEntry({ triggers: [{ on: "startOfTurn", do: [{ type: "damage", to: "self", activity: "abcdefghijklmnop" }] }] }, { facts })).toEqual([]);
  });
  it("`rollDisadvantage` : jets connus, condition sur des faits connus", () => {
    expect(validateEntry({ rollDisadvantage: { on: ["check", "save"] } }, { facts })).toEqual([]);
    expect(validateEntry({ rollDisadvantage: { on: ["attack"] } }, { facts }).join()).toMatch(/rollDisadvantage/);
    expect(validateEntry({ rollDisadvantage: { on: [] } }, { facts }).join()).toMatch(/rollDisadvantage/);
    expect(validateEntry({ rollDisadvantage: { on: ["check"], when: {} } }, { facts }).join()).toMatch(/rollDisadvantage/);
    expect(validateEntry({ rollDisadvantage: { on: ["check"], if: { "self.inTheRain": true } } }, { facts }).join()).toMatch(/unknown fact "self.inTheRain"/);
  });
});

/* -------------------------------------------- */

describe("§484 : eau courante et faits `self.*`", () => {
  let inRunningWater, factsFor;
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.canvas = null;
    ({ inRunningWater } = await import("../module/scripts/adapter/running-water.mjs"));
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });

  /** Une scène carrée de 100 px par case ; une région marquée couvre x < 300. */
  function sceneWith({ regionMarked=true, sceneMarked=false }={}) {
    const region = { getFlag: (scope, key) => ((scope === "dnd5e-combat") && (key === "runningWater") && regionMarked) || undefined,
      testPoint: p => p.x < 300 };
    return { grid: { sizeX: 100, sizeY: 100 }, regions: [region],
      getFlag: (scope, key) => ((scope === "dnd5e-combat") && (key === "runningWater") && sceneMarked) || undefined };
  }
  const tokenAt = (scene, x) => ({ parent: scene, x, y: 0, width: 1, height: 1, elevation: 0, _source: { x, y: 0, width: 1, height: 1, elevation: 0 } });

  it("dans une région marquée : oui ; à côté : non", () => {
    const scene = sceneWith();
    expect(inRunningWater(tokenAt(scene, 100))).toBe(true);
    expect(inRunningWater(tokenAt(scene, 500))).toBe(false);
  });
  it("une région non marquée n'est pas de l'eau courante ; une scène marquée l'est partout", () => {
    expect(inRunningWater(tokenAt(sceneWith({ regionMarked: false }), 100))).toBe(false);
    expect(inRunningWater(tokenAt(sceneWith({ regionMarked: false, sceneMarked: true }), 900))).toBe(true);
  });
  it("sans token : non", () => {
    expect(inRunningWater(null)).toBe(false);
  });
  it("les faits regardent la créature `self` (son token donné)", () => {
    const scene = sceneWith();
    const self = { name: "créature" };
    const wet = factsFor({ self, selfToken: tokenAt(scene, 100) });
    const dry = factsFor({ self, selfToken: tokenAt(scene, 500) });
    expect(wet["self.inRunningWater"](true)).toBe(true);
    expect(dry["self.inRunningWater"](true)).toBe(false);
    expect(dry["self.inRunningWater"](false)).toBe(true);
  });
  it("sans scène prête, ni soleil ni lumière vive ; sans `self`, faux", () => {
    const f = factsFor({ self: { name: "créature" }, selfToken: tokenAt(sceneWith(), 100) });
    expect(f["self.inSunlight"](true)).toBe(false);
    expect(f["self.inSunlight"](false)).toBe(true);
    const none = factsFor();
    for ( const key of ["self.inSunlight", "self.inBrightLight", "self.inRunningWater", "target.inSunlight", "target.inRunningWater", "source.inRunningWater"] ) {
      expect(none[key](true)).toBe(false);
    }
  });
});
