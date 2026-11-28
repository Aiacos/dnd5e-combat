import { describe, it, expect } from "vitest";
import { FLOAT_KINDS, floatStyleDefault, floatThemeFrom, floatThemeExport, floatStyleOf, floatOffset, floatEntrance, hpFloat }
  from "../module/scripts/core/float-text.mjs";

describe("floating text theme (§400)", () => {
  it("without a theme, each kind keeps the engine's original look", () => {
    expect(floatStyleOf({}, "critical")).toMatchObject({ color: "#ffd24a", size: 30, icon: "explosion", motion: "float", font: "Signika" });
    expect(floatStyleOf({}, "cover").icon).toBe("shield");
    for ( const kind of FLOAT_KINDS ) expect(floatStyleDefault(kind).show).toBe(true);
  });
  it("a workshop JSON is read, bounded, and what is invalid is refused", () => {
    const json = { format: "das-float-theme", version: 1,
      global: { floatDuration: 99, floatDirection: "up", floatDice: false, gridPx: 70 },
      types: {
        saveFail: { color: "#EFE9DC", font: "Cormorant Garamond", size: 200, motion: "anchor", badge: "hex", icon: "d20", spin: true },
        miss: { color: "rouge", motion: "spirale", font: "Comic Sans", icon: "<script>" },
        "dmg-fire": { color: "#ff7a2a", motion: "arc" },
        "bad key!": { color: "#000000" }
      } };
    const { theme, global, problems } = floatThemeFrom(JSON.stringify(json), { fonts: ["Signika", "Cormorant Garamond"] });
    expect(theme.saveFail).toMatchObject({ color: "#efe9dc", font: "Cormorant Garamond", size: 64, motion: "anchor", badge: "hex", icon: "d20", spin: true });
    expect(theme.miss).toMatchObject({ color: "#d0d0d0", motion: "float", font: "Signika", icon: "none" });
    expect(theme["dmg-fire"]).toMatchObject({ color: "#ff7a2a", motion: "arc" });
    expect(theme["bad key!"]).toBeUndefined();
    expect(problems).toEqual(expect.arrayContaining(["miss.color", "miss.motion", "miss.icon", "miss.font: Comic Sans", "bad key!"]));
    expect(global).toEqual({ floatDuration: 10, floatDirection: "up", floatDice: false });
  });
  it("the workshop font name \"Signika (Foundry)\" is reduced to the family", () => {
    expect(floatThemeFrom({ types: { hit: { font: "Signika (Foundry)" } } }, { fonts: ["Signika"] }).theme.hit.font).toBe("Signika");
  });
  it("a file that is not a theme is refused", () => {
    expect(() => floatThemeFrom({ foo: 1 })).toThrow();
    expect(() => floatThemeFrom({ format: "autre", types: {} })).toThrow();
    expect(() => floatThemeFrom("{pas du json")).toThrow();
  });
  it("l'export porte toutes les sortes et se relit tel quel", () => {
    const out = floatThemeExport({ critical: { ...floatStyleDefault("critical"), color: "#123456" } }, { floatDuration: 3 });
    expect(Object.keys(out.types)).toEqual(expect.arrayContaining(FLOAT_KINDS));
    const back = floatThemeFrom(out);
    expect(back.theme.critical.color).toBe("#123456");
    expect(back.global.floatDuration).toBe(3);
    expect(back.problems).toEqual([]);
  });
  it("the paths: scrolls, stays above, arc to the side", () => {
    expect(floatOffset(1, "float", { travel: 100 }).dy).toBeCloseTo(100);
    expect(floatOffset(0.5, "anchor", { travel: 100 })).toEqual({ dx: 0, dy: 0 });
    const mid = floatOffset(0.5, "arc", { side: -1, spread: 50, rise: 40, drop: 20 });
    expect(mid.dx).toBeLessThan(0);
    expect(mid.dy).toBeCloseTo(-40 + 10);
    expect(floatOffset(1, "arc", { side: 1, spread: 50, rise: 40, drop: 20 })).toEqual({ dx: 50, dy: 20 });
  });
  it("the appearances end at scale 1, without sliding", () => {
    for ( const e of ["fade", "grow", "pop", "slide"] ) expect(floatEntrance(0.5, e)).toEqual({ scale: 1, dx: 0 });
    expect(floatEntrance(0, "grow").scale).toBeCloseTo(0.6);
    expect(floatEntrance(0.1, "pop").scale).toBeCloseTo(1.4);
  });
  it("HP: the kind and the size as in dnd5e", () => {
    expect(hpFloat({ hp: -12, temp: 0, total: -12 }, 24)).toEqual({ kind: "damage", value: -12, factor: 1.2 });
    expect(hpFloat({ hp: 5, temp: 0, total: 5 }, 50)?.kind).toBe("healing");
    expect(hpFloat({ hp: 0, temp: 6, total: 6 }, 50)?.kind).toBe("temp");
    expect(hpFloat({ hp: 0, temp: 0, total: 0 }, 50)).toBeNull();
    expect(hpFloat({ hp: -100, temp: 0, total: -100 }, 10).factor).toBeCloseTo(1.8);
  });
});

import { floatOutcome, floatRolled, spinPhase, FLOAT_CATEGORIES, FLOAT_CATEGORY_DEFAULTS, floatLine } from "../module/scripts/core/float-text.mjs";

describe("hexagone de jet et initiative (§400, lot 2)", () => {
  it("the outcome colors the border: success, miss, neutral", () => {
    expect(floatOutcome("saveSuccess")).toBe("ok");
    expect(floatOutcome("checkSuccess")).toBe("ok");
    expect(floatOutcome("saveFail")).toBe("fail");
    expect(floatOutcome("miss")).toBe("fail");
    expect(floatOutcome("initiative")).toBeNull();
    expect(floatOutcome("check")).toBeNull();
  });
  it("the hexagon spins during the throw, then beats once and the text comes", () => {
    expect(spinPhase(450, 900)).toMatchObject({ spinning: true, text: 0, pulse: 1 });
    expect(spinPhase(450, 900).angle).toBeGreaterThan(0);
    expect(spinPhase(900, 900)).toEqual({ spinning: false, angle: 0, pulse: 1.4, text: 0 });
    expect(spinPhase(1300, 900)).toEqual({ spinning: false, angle: 0, pulse: 1, text: 1 });
  });
  it("Initiative carries a roll and has its own setting", () => {
    expect(floatRolled("initiative")).toBe(true);
    expect(floatRolled("cover")).toBe(false);
    expect(FLOAT_CATEGORIES.initiative).toBe("floatInitiative");
    expect(FLOAT_CATEGORY_DEFAULTS.floatInitiative).toBe(true);
    expect(floatLine({ kind: "initiative", roll: 17 }, "Initiative")).toMatchObject({ text: "Initiative", roll: 17 });
    expect(floatLine({ kind: "initiative", roll: 17 }, "Initiative", { show: { floatInitiative: false } })).toBeNull();
  });
});

import { damageParts, damageKind, DAMAGE_KINDS } from "../module/scripts/core/float-text.mjs";

describe("damage by type (§400, batch 3)", () => {
  it("the dnd5e parts grouped by type, healing and Temporary Hit Points set aside, the strongest first", () => {
    const damages = [{ type: "slashing", value: 7 }, { type: "fire", value: 9 }, { type: "fire", value: 3 }, { type: "cold", value: 0 },
      { type: "healing", value: -5 }, { type: "temphp", value: 4 }, { type: "radiant", value: 2.7 }];
    expect(damageParts(damages)).toEqual([{ type: "fire", value: 12 }, { type: "slashing", value: 7 }, { type: "radiant", value: 2 }]);
    expect(damageParts(null)).toEqual([]);
  });
  it("each dnd5e type has its kind, an unknown type takes \"damage\"", () => {
    expect(DAMAGE_KINDS).toEqual(expect.arrayContaining(["fire", "cold", "necrotic", "slashing", "thunder"]));
    expect(damageKind("fire")).toBe("dmg-fire");
    expect(damageKind("homebrew")).toBe("damage");
    expect(floatStyleOf({}, "dmg-fire")).toMatchObject({ color: "#ff7a2a", motion: "arc", entrance: "pop", weight: 700 });
    expect(floatStyleOf({}, "damage").motion).toBe("arc");
    expect(floatStyleOf({}, "healing").motion).toBe("float");
  });
});

import { saveKind } from "../module/scripts/core/float-text.mjs";

describe("sauvegarde de la fiche (§400)", () => {
  it("succeeded, failed, or neutral without a DC", () => {
    expect(saveKind({ total: 14, target: 13 })).toBe("saveSuccess");
    expect(saveKind({ total: 9, target: 13, isFailure: true })).toBe("saveFail");
    expect(saveKind({ total: 12 })).toBe("save");
    expect(floatOutcome("save")).toBeNull();
    expect(floatRolled("save")).toBe(true);
  });
});

describe("inherited look (§400)", () => {
  it("a save without a DC takes the look of the successful save if the theme does not define it", () => {
    const theme = { saveSuccess: { ...floatStyleDefault("saveSuccess"), spin: true, motion: "anchor" } };
    expect(floatStyleOf(theme, "save")).toMatchObject({ spin: true, motion: "anchor" });
    expect(floatStyleOf({ ...theme, save: { ...floatStyleDefault("save"), spin: false } }, "save").spin).toBe(false);
  });
});

describe("tests comme les sauvegardes (§400)", () => {
  it("a check takes the look of the save with the same outcome, its own theme is ignored", () => {
    const theme = {
      saveSuccess: { ...floatStyleDefault("saveSuccess"), spin: true, motion: "anchor", color: "#111111" },
      saveFail: { ...floatStyleDefault("saveFail"), spin: true, motion: "anchor", color: "#222222" },
      checkSuccess: { ...floatStyleDefault("checkSuccess"), spin: false, motion: "float" }
    };
    expect(floatStyleOf(theme, "checkSuccess")).toMatchObject({ spin: true, motion: "anchor", color: "#111111" });
    expect(floatStyleOf(theme, "checkFail")).toMatchObject({ spin: true, motion: "anchor", color: "#222222" });
    expect(floatStyleOf(theme, "check")).toMatchObject({ spin: true, motion: "anchor", color: "#111111" });
    expect(floatOutcome("checkFail")).toBe("fail");
  });
});

import { strikeProgress } from "../module/scripts/core/float-text.mjs";

describe("lost condition struck through (§400)", () => {
  it("struck through by default for the ending effect only, adjustable in the theme", () => {
    expect(floatStyleDefault("effectOff").strike).toBe(true);
    expect(floatStyleDefault("effectOn").strike).toBe(false);
    expect(floatThemeFrom({ types: { effectOff: { strike: false } } }).theme.effectOff.strike).toBe(false);
  });
  it("the bar waits for the text, then crosses it from left to right", () => {
    expect(strikeProgress(0)).toBe(0);
    expect(strikeProgress(350)).toBe(0);
    expect(strikeProgress(575)).toBeGreaterThan(0.5);
    expect(strikeProgress(800)).toBe(1);
    expect(strikeProgress(5000)).toBe(1);
  });
});
