// #269 (journal §545): one attack, several hit targets, only some of them Critical Hits — the damage is rolled normally, the
// extra critical dice apart, and each target takes the critical part only if it is a Critical Hit.
import { describe, it, expect } from "vitest";
import { criticalExtraFormula, criticalSplit } from "../module/scripts/core/critical-dice.mjs";
import { open, advance, mixedCriticalTokens, damageFor, isCriticalHit } from "../module/scripts/core/action.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

const dice = (number, faces, extra={}) => ({ number, faces, modifiers: [], ...extra });
const op = operator => ({ operator });
const flat = number => ({ number });

describe("criticalExtraFormula: what a Critical Hit adds to the normal roll (mirrors dnd5e's configureDamage)", () => {
  it("SRD rule: the damage dice once more, not the modifier", () => {
    expect(criticalExtraFormula([dice(1, 8), op("+"), flat(3)])).toBe("1d8");
    expect(criticalExtraFormula([dice(2, 6, { flavor: "slashing" }), op("+"), flat(4), op("+"), dice(3, 6)])).toBe("2d6[slashing] + 3d6");
  });

  it("dnd5e setting « multiply modifiers »: the flat parts too", () => {
    expect(criticalExtraFormula([dice(1, 8), op("+"), flat(3)], { multiplyNumeric: true })).toBe("1d8 + 3");
  });

  it("dnd5e setting « maximize the extra dice »: the dice's maximum, flat", () => {
    expect(criticalExtraFormula([dice(2, 6), op("+"), flat(3)], { powerfulCritical: true })).toBe("12");
  });

  it("bonus dice (Piercer, Brutal Critical…) on the roll's first die, bonus damage once", () => {
    expect(criticalExtraFormula([dice(1, 12), op("+"), dice(1, 6)], { bonusDice: 1 })).toBe("2d12 + 1d6");
    expect(criticalExtraFormula([dice(1, 8)], { bonusDamage: "1d4" })).toBe("1d8 + 1d4");
  });

  it("a die with modifiers is copied whole (Great Weapon Fighting, Elemental Adept)", () => {
    expect(criticalExtraFormula([dice(2, 6, { modifiers: ["min3"] }), op("+"), flat(4)])).toBe("2d6min3");
  });

  it("a subtracted die stays subtracted, a multiplied one keeps its factor", () => {
    expect(criticalExtraFormula([dice(2, 6), op("-"), dice(1, 4)])).toBe("2d6 - 1d4");
    expect(criticalExtraFormula([dice(2, 6), op("*"), flat(2)])).toBe("(2d6) * 2");
  });

  it("another random term is copied, a deterministic one adds nothing; a flat roll adds nothing", () => {
    expect(criticalExtraFormula([{ formula: "{1d6,1d8}kh", deterministic: false, max: 8 }])).toBe("{1d6,1d8}kh");
    expect(criticalExtraFormula([{ formula: "(2 + 3)", deterministic: true, max: 5 }])).toBe("");
    expect(criticalExtraFormula([flat(5)])).toBe("");
  });
});

describe("criticalSplit", () => {
  it("none, all or mixed, among the hit targets only", () => {
    expect(criticalSplit([{ hit: true }, { hit: false, critical: false }])).toBe("none");
    expect(criticalSplit([{ hit: true, critical: true }, { hit: false }])).toBe("all");
    expect(criticalSplit([{ hit: true, critical: true }, { hit: true, critical: false }])).toBe("mixed");
  });
});

describe("resolution: the critical part goes to the Critical Hit targets only", () => {
  const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Target ${n}`, ac: 12, ...extra });
  const plan = { attack: true, damage: "author", save: null, effects: [], choice: null };
  const play = (first, ...events) => events.reduce((acc, e) => advance(acc.resolution, e), first);
  const PIERCING = [{ type: "piercing", value: 7, properties: [] }];
  const EXTRA = [{ type: "piercing", value: 5, properties: [] }];

  it("a Paralyzed target within 5 ft is a Critical Hit, the other is not: mixed, one token", () => {
    const { resolution } = play(open({ ...RESOLUTION_BASE, plan, targets: [] }),
      { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { defenceless: true }), T(2)] });
    expect(resolution.targets.map(t => [t.hit, t.critical])).toEqual([[true, true], [true, false]]);
    expect(isCriticalHit(resolution)).toBe(true);
    expect(mixedCriticalTokens(resolution)).toEqual(["T1"]);
  });

  it("the damage roll keeps its critical part apart; each target gets its own share", () => {
    const opened = play(open({ ...RESOLUTION_BASE, plan, targets: [] }),
      { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { defenceless: true }), T(2)] },
      { type: "damageRolled", messageId: "Dmg", damages: PIERCING, critical: EXTRA });
    const resolution = opened.resolution;
    expect(resolution.damageRoll).toEqual({ messageId: "Dmg", damages: PIERCING, critical: EXTRA });
    expect(damageFor(resolution, "T1")).toEqual([...PIERCING, ...EXTRA]);
    expect(damageFor(resolution, "T2")).toEqual(PIERCING);
  });

  it("every hit target critical, or a single target: unchanged — one roll, no part apart", () => {
    const { resolution } = play(open({ ...RESOLUTION_BASE, plan, targets: [] }),
      { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { defenceless: true })] },
      { type: "damageRolled", messageId: "Dmg", damages: PIERCING });
    expect(mixedCriticalTokens(resolution)).toEqual([]);
    expect(resolution.damageRoll).toEqual({ messageId: "Dmg", damages: PIERCING });
    expect(damageFor(resolution, "T1")).toEqual(PIERCING);
  });

  it("a target whose critical a reaction or its armour removed takes no critical part", () => {
    const { resolution } = play(open({ ...RESOLUTION_BASE, plan, targets: [] }),
      { type: "attackRolled", roll: { total: 15, isCritical: false, isFumble: false }, messageId: "Atk",
        targets: [T(1, { defenceless: true }), T(2, { defenceless: true, noCrit: true })] },
      { type: "damageRolled", messageId: "Dmg", damages: PIERCING, critical: EXTRA });
    expect(mixedCriticalTokens({ ...resolution, damageRoll: null })).toEqual(["T1"]);
    expect(damageFor(resolution, "T2")).toEqual(PIERCING);
  });
});
