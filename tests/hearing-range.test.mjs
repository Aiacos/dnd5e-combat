/**
 * Setting `hearingRange` read on an actor (adapter/hearing.mjs): empty — no range, the official rule; otherwise the formula,
 * in feet, with the actor's roll data, converted to the scene's unit and read again when the sheet changes.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

let hearingRangeOf, clearHearingRanges;
let formula = "";
let evaluated = 0;

const actorOf = passive => ({ getRollData: () => ({ skills: { prc: { passive } } }) });
const tokenOf = (actor, units="ft") => ({ actor, parent: { grid: { units } } });

beforeAll(async () => {
  globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
  globalThis.game = { user: { isGM: true }, users: {}, modules: { get: () => null },
    settings: { register() {}, get: (scope, key) => (key === "hearingRange") ? formula : undefined },
    i18n: { localize: k => k, format: k => k, lang: "en" } };
  globalThis.foundry = { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
  globalThis.CONFIG = { DND5E: { movementUnits: { ft: { conversion: 1 }, m: { conversion: 3.28084 } } }, specialStatusEffects: {},
    queries: {} };
  // The bare minimum of Roll: the `@chemin` replaced by the data, then the arithmetic.
  globalThis.Roll = {
    replaceFormulaData: (text, data, { missing }={}) => text.replace(/@([\w.]+)/g, (m, path) => {
      const value = path.split(".").reduce((o, k) => o?.[k], data);
      return (value === undefined) ? missing : String(value);
    }),
    safeEval: text => {
      evaluated += 1;
      if ( !/^[\d\s+\-*/().]+$/.test(text) ) throw new Error("unsafe");
      return Function(`return (${text});`)();
    }
  };
  ({ hearingRangeOf, clearHearingRanges } = await import("../module/scripts/adapter/hearing.mjs"));
}, 60000);

beforeEach(() => { formula = ""; evaluated = 0; clearHearingRanges(); });

describe("an observer's hearing range", () => {
  it("empty setting: no range, and nothing is evaluated", () => {
    expect(hearingRangeOf(tokenOf(actorOf(14)))).toBe(null);
    expect(evaluated).toBe(0);
  });
  it("the formula, with the actor's passive Perception, in feet", () => {
    formula = "15 + 2.5 * (@skills.prc.passive - 10)";
    expect(hearingRangeOf(tokenOf(actorOf(10)))).toBe(15);
    expect(hearingRangeOf(tokenOf(actorOf(14)))).toBe(25);
  });
  it("converted to the scene's unit", () => {
    formula = "30";
    expect(hearingRangeOf(tokenOf(actorOf(10), "m"))).toBeCloseTo(30 / 3.28084, 3);
  });
  it("a wrong or negative formula: no range rather than a hearing turned off", () => {
    formula = "15 + oops";
    expect(hearingRangeOf(tokenOf(actorOf(10)))).toBe(null);
    formula = "-20";
    expect(hearingRangeOf(tokenOf(actorOf(10)))).toBe(null);
  });
  it("read once per actor, read again when the formula changes or after `clearHearingRanges`", () => {
    formula = "@skills.prc.passive * 2";
    const actor = actorOf(12);
    const token = tokenOf(actor);
    expect(hearingRangeOf(token)).toBe(24);
    expect(hearingRangeOf(token)).toBe(24);
    expect(evaluated).toBe(1);
    formula = "@skills.prc.passive * 3";
    expect(hearingRangeOf(token)).toBe(36);
    expect(evaluated).toBe(2);
    actor.getRollData = () => ({ skills: { prc: { passive: 20 } } });
    expect(hearingRangeOf(token)).toBe(36);
    clearHearingRanges();
    expect(hearingRangeOf(token)).toBe(60);
  });
});
