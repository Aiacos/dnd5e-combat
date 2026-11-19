/**
 * Réglage `hearingRange` lu sur un acteur (adapter/hearing.mjs) : vide — pas de portée, la règle officielle ; sinon la formule,
 * en pieds, avec les données de jet de l'acteur, convertie à l'unité de la scène et relue quand la fiche change.
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
  // Le strict nécessaire de Roll : les `@chemin` remplacés par la donnée, puis l'arithmétique.
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

describe("portée d'ouïe d'un observateur", () => {
  it("réglage vide : pas de portée, et rien n'est évalué", () => {
    expect(hearingRangeOf(tokenOf(actorOf(14)))).toBe(null);
    expect(evaluated).toBe(0);
  });
  it("la formule, avec la Perception passive de l'acteur, en pieds", () => {
    formula = "15 + 2.5 * (@skills.prc.passive - 10)";
    expect(hearingRangeOf(tokenOf(actorOf(10)))).toBe(15);
    expect(hearingRangeOf(tokenOf(actorOf(14)))).toBe(25);
  });
  it("convertie à l'unité de la scène", () => {
    formula = "30";
    expect(hearingRangeOf(tokenOf(actorOf(10), "m"))).toBeCloseTo(30 / 3.28084, 3);
  });
  it("une formule fausse, ou négative : pas de portée plutôt qu'une ouïe éteinte", () => {
    formula = "15 + oops";
    expect(hearingRangeOf(tokenOf(actorOf(10)))).toBe(null);
    formula = "-20";
    expect(hearingRangeOf(tokenOf(actorOf(10)))).toBe(null);
  });
  it("lue une fois par acteur, relue quand la formule change ou après `clearHearingRanges`", () => {
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
