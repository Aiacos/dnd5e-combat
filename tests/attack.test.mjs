import { describe, it, expect } from "vitest";
import { resolveAttack, hitsRegardless, attackMark } from "../module/scripts/core/attack.mjs";

const gobelin = { token: "Scene.s.Token.g", name: "Gobelin", ac: 15 };
const ogre = { token: "Scene.s.Token.o", name: "Ogre", ac: 11 };
const roll = (total, flags = {}) => ({ total, isCritical: false, isFumble: false, ...flags });

describe("resolveAttack", () => {
  it("hits when the total equals the AC", () => {
    expect(resolveAttack(roll(15), [gobelin])[0]).toMatchObject({ hit: true, critical: false, reason: "ac" });
  });
  it("rate sous la CA", () => {
    expect(resolveAttack(roll(14), [gobelin])[0]).toMatchObject({ hit: false, reason: "miss" });
  });
  it("a natural 20 hits even an unreachable AC, and it is a Critical Hit", () => {
    const [r] = resolveAttack(roll(21, { isCritical: true }), [{ ...gobelin, ac: 30 }]);
    expect(r).toMatchObject({ hit: true, critical: true, reason: "critical" });
  });
  it("a lowered critical threshold does not make a hit: a natural 19 misses an unreachable AC", () => {
    const champion = roll(24, { isCritical: true, natural: 19 });   // 19 + 5
    expect(resolveAttack(champion, [{ ...gobelin, ac: 25 }])[0]).toMatchObject({ hit: false, critical: false, reason: "miss" });
  });
  it("the same 19 is a Critical Hit when the total reaches the AC", () => {
    const champion = roll(24, { isCritical: true, natural: 19 });
    expect(resolveAttack(champion, [{ ...gobelin, ac: 24 }])[0]).toMatchObject({ hit: true, critical: true, reason: "critical" });
  });
  it("a recorded natural 20 always hits; a critical without a recorded d20 (old message) too", () => {
    expect(resolveAttack(roll(21, { isCritical: true, natural: 20 }), [{ ...gobelin, ac: 30 }])[0]).toMatchObject({ hit: true, critical: true });
    expect(resolveAttack(roll(21, { isCritical: true }), [{ ...gobelin, ac: 30 }])[0]).toMatchObject({ hit: true, critical: true });
  });
  it("a natural 1 misses even if the total is enough", () => {
    expect(resolveAttack(roll(16, { isFumble: true }), [gobelin])[0]).toMatchObject({ hit: false, reason: "fumble" });
  });
  it("Total Cover cannot be hit, even on a critical", () => {
    const [r] = resolveAttack(roll(25, { isCritical: true }), [{ ...gobelin, ac: null }]);
    expect(r).toMatchObject({ hit: false, critical: false, reason: "cover" });
  });
  it("decides each target separately", () => {
    expect(resolveAttack(roll(12), [gobelin, ogre]).map(t => t.hit)).toEqual([false, true]);
  });
});

import { throwableAttackMode } from "../module/scripts/core/attack.mjs";

describe("§39.2 mode of a thrown weapon", () => {
  const dagger = { byDefault: "oneHanded", canThrow: true, hasTargets: true };
  it("a remembered \"throw\" against a target within reach goes back to the default mode", () => {
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "thrown", allBeyondReach: false })).toBe("oneHanded");
    expect(throwableAttackMode({ ...dagger, requested: "thrown-offhand", remembered: "thrown-offhand", allBeyondReach: false })).toBe("oneHanded");
  });
  it("out of reach: throw, preselected or kept", () => {
    expect(throwableAttackMode({ ...dagger, requested: "oneHanded", remembered: "oneHanded", allBeyondReach: true })).toBe("thrown");
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "thrown", allBeyondReach: true })).toBeNull();
    expect(throwableAttackMode({ ...dagger, requested: null, remembered: null, allBeyondReach: true })).toBe("thrown");
  });
  it("a requested mode (not from memory) is kept", () => {
    expect(throwableAttackMode({ ...dagger, requested: "offhand", remembered: "thrown", allBeyondReach: false })).toBeNull();
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "oneHanded", allBeyondReach: false })).toBeNull();
  });
  it("a remembered off hand is left alone (off topic)", () => {
    expect(throwableAttackMode({ ...dagger, requested: "offhand", remembered: "offhand", allBeyondReach: false })).toBeNull();
  });
  it("sans cible, rien", () => {
    expect(throwableAttackMode({ ...dagger, hasTargets: false, requested: "thrown", remembered: "thrown", allBeyondReach: false })).toBeNull();
  });
});

describe("critical by exceeding the AC (§207)", async () => {
  const { beatsAcBy } = await import("../module/scripts/core/attack.mjs");
  const { hitChance } = await import("../module/scripts/core/hitchance.mjs");
  it("a hit that exceeds the AC by the margin becomes a critical; disabled at 0", () => {
    expect(beatsAcBy({ hit: true, critical: false, ac: 12 }, { total: 22 }, 10)).toBe(true);
    expect(beatsAcBy({ hit: true, critical: false, ac: 12 }, { total: 21 }, 10)).toBe(false);
    expect(beatsAcBy({ hit: true, critical: false, ac: 12 }, { total: 30 }, 0)).toBe(false);
    expect(beatsAcBy({ hit: false, critical: false, ac: 12 }, { total: 30 }, 10)).toBe(false);
    expect(beatsAcBy({ hit: true, critical: false, ac: null }, { total: 30 }, 10)).toBe(false);
  });
  it("the critical chances count the margin", () => {
    const base = hitChance({ ac: 10, bonus: 10 });
    const withMargin = hitChance({ ac: 10, bonus: 10, margin: 10 });
    expect(withMargin.hit).toBeCloseTo(base.hit, 6);
    // d20 + 10 ≥ 20: 10 to 19 (ten faces) on top of the natural 20.
    expect(withMargin.critical).toBeCloseTo(11 / 20, 6);
    expect(base.critical).toBeCloseTo(1 / 20, 6);
  });
});

import { exclusiveWeaponHindrances } from "../module/scripts/core/attack.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("O8e (§348): Disadvantage with other weapons", () => {
  const rules = [{ item: "axe", name: "Hache du berserker", active: true }, { item: "bow", name: "Arc du serment", active: false }];
  it("another weapon: the Disadvantage of each active rule", () => {
    expect(exclusiveWeaponHindrances(rules, "sword")).toEqual(["Hache du berserker"]);
  });
  it("the weapon itself, a non-weapon attack or an inactive rule: nothing", () => {
    expect(exclusiveWeaponHindrances(rules, "axe")).toEqual([]);
    expect(exclusiveWeaponHindrances(rules, null)).toEqual([]);
    expect(exclusiveWeaponHindrances([{ item: "bow", name: "Arc", active: false }], "sword")).toEqual([]);
  });
  it("validation : true ou { whileEffect }", () => {
    expect(validateEntry({ exclusiveWeapon: true })).toEqual([]);
    expect(validateEntry({ exclusiveWeapon: { whileEffect: "EWoLqkPJeK9dwYhn" } })).toEqual([]);
    expect(validateEntry({ exclusiveWeapon: { whileEffect: "x" } }).length).toBe(1);
    expect(validateEntry({ exclusiveWeapon: false }).length).toBe(1);
  });
});

describe("hitsRegardless : le jet que l'Inspiration ne peut plus rattraper", () => {
  it("a 19 at the lowered threshold does not hit automatically: miss, Inspiration is still offered", () => {
    const champion = roll(24, { isCritical: true, natural: 19 });
    expect(hitsRegardless(champion)).toBe(false);
    // What `inspiredAttack` (runtime/engine-messages.mjs) then reads: the target missed, so the offer.
    expect(resolveAttack(champion, [{ ...gobelin, ac: 25 }]).filter(t => t.reason === "miss")).toHaveLength(1);
    // The Inspiration die added (+2): the same 19 becomes a Critical Hit.
    expect(resolveAttack({ ...champion, total: 26 }, [{ ...gobelin, ac: 25 }])[0]).toMatchObject({ hit: true, critical: true });
  });
  it("a natural 20, or a critical without a recorded d20, hits automatically; an ordinary roll or a natural 1, not", () => {
    expect(hitsRegardless(roll(21, { isCritical: true, natural: 20 }))).toBe(true);
    expect(hitsRegardless(roll(21, { isCritical: true }))).toBe(true);
    expect(hitsRegardless(roll(21))).toBe(false);
    expect(hitsRegardless(roll(6, { isFumble: true }))).toBe(false);
  });
});

describe("attackMark: what the card announces about the roll", () => {
  const champion = roll(24, { isCritical: true, natural: 19 });
  it("a 19 at the lowered threshold that misses is not announced as critical; the same one that hits, yes", () => {
    expect(attackMark(champion, resolveAttack(champion, [{ ...gobelin, ac: 25 }]))).toBe(null);
    expect(attackMark(champion, resolveAttack(champion, [{ ...gobelin, ac: 25 }, { ...ogre }]))).toBe("critical");
  });
  it("without a verdict (card without resolution): announced, as the system does", () => {
    expect(attackMark(champion)).toBe("critical");
  });
  it("natural 20: critical even if the verdict is missing or discards it; natural 1: failure; ordinary roll: nothing", () => {
    expect(attackMark(roll(21, { isCritical: true, natural: 20 }), [])).toBe("critical");
    expect(attackMark(roll(6, { isFumble: true, natural: 1 }))).toBe("fumble");
    expect(attackMark(roll(17, { natural: 12 }), [])).toBe(null);
  });
});
