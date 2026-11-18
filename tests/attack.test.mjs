import { describe, it, expect } from "vitest";
import { resolveAttack, hitsRegardless, attackMark } from "../module/scripts/core/attack.mjs";

const gobelin = { token: "Scene.s.Token.g", name: "Gobelin", ac: 15 };
const ogre = { token: "Scene.s.Token.o", name: "Ogre", ac: 11 };
const roll = (total, flags = {}) => ({ total, isCritical: false, isFumble: false, ...flags });

describe("resolveAttack", () => {
  it("touche quand le total égale la CA", () => {
    expect(resolveAttack(roll(15), [gobelin])[0]).toMatchObject({ hit: true, critical: false, reason: "ac" });
  });
  it("rate sous la CA", () => {
    expect(resolveAttack(roll(14), [gobelin])[0]).toMatchObject({ hit: false, reason: "miss" });
  });
  it("un 20 naturel touche même une CA hors d'atteinte, et c'est un critique", () => {
    const [r] = resolveAttack(roll(21, { isCritical: true }), [{ ...gobelin, ac: 30 }]);
    expect(r).toMatchObject({ hit: true, critical: true, reason: "critical" });
  });
  it("un seuil de critique abaissé ne fait pas toucher : un 19 naturel rate une CA hors d'atteinte", () => {
    const champion = roll(24, { isCritical: true, natural: 19 });   // 19 + 5
    expect(resolveAttack(champion, [{ ...gobelin, ac: 25 }])[0]).toMatchObject({ hit: false, critical: false, reason: "miss" });
  });
  it("le même 19 est un coup critique quand le total atteint la CA", () => {
    const champion = roll(24, { isCritical: true, natural: 19 });
    expect(resolveAttack(champion, [{ ...gobelin, ac: 24 }])[0]).toMatchObject({ hit: true, critical: true, reason: "critical" });
  });
  it("un 20 naturel noté touche toujours ; un critique sans d20 noté (ancien message) aussi", () => {
    expect(resolveAttack(roll(21, { isCritical: true, natural: 20 }), [{ ...gobelin, ac: 30 }])[0]).toMatchObject({ hit: true, critical: true });
    expect(resolveAttack(roll(21, { isCritical: true }), [{ ...gobelin, ac: 30 }])[0]).toMatchObject({ hit: true, critical: true });
  });
  it("un 1 naturel rate même si le total suffit", () => {
    expect(resolveAttack(roll(16, { isFumble: true }), [gobelin])[0]).toMatchObject({ hit: false, reason: "fumble" });
  });
  it("un abri total ne peut pas être touché, même sur un critique", () => {
    const [r] = resolveAttack(roll(25, { isCritical: true }), [{ ...gobelin, ac: null }]);
    expect(r).toMatchObject({ hit: false, critical: false, reason: "cover" });
  });
  it("tranche chaque cible séparément", () => {
    expect(resolveAttack(roll(12), [gobelin, ogre]).map(t => t.hit)).toEqual([false, true]);
  });
});

import { throwableAttackMode } from "../module/scripts/core/attack.mjs";

describe("§39.2 mode d'une arme qui se lance", () => {
  const dagger = { byDefault: "oneHanded", canThrow: true, hasTargets: true };
  it("un « lancer » mémorisé contre une cible à l'allonge redevient le mode par défaut", () => {
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "thrown", allBeyondReach: false })).toBe("oneHanded");
    expect(throwableAttackMode({ ...dagger, requested: "thrown-offhand", remembered: "thrown-offhand", allBeyondReach: false })).toBe("oneHanded");
  });
  it("hors d'allonge : lancer, présélectionné ou gardé", () => {
    expect(throwableAttackMode({ ...dagger, requested: "oneHanded", remembered: "oneHanded", allBeyondReach: true })).toBe("thrown");
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "thrown", allBeyondReach: true })).toBeNull();
    expect(throwableAttackMode({ ...dagger, requested: null, remembered: null, allBeyondReach: true })).toBe("thrown");
  });
  it("un mode demandé (pas de la mémoire) est gardé", () => {
    expect(throwableAttackMode({ ...dagger, requested: "offhand", remembered: "thrown", allBeyondReach: false })).toBeNull();
    expect(throwableAttackMode({ ...dagger, requested: "thrown", remembered: "oneHanded", allBeyondReach: false })).toBeNull();
  });
  it("une main secondaire mémorisée n'est pas touchée (hors sujet)", () => {
    expect(throwableAttackMode({ ...dagger, requested: "offhand", remembered: "offhand", allBeyondReach: false })).toBeNull();
  });
  it("sans cible, rien", () => {
    expect(throwableAttackMode({ ...dagger, hasTargets: false, requested: "thrown", remembered: "thrown", allBeyondReach: false })).toBeNull();
  });
});

describe("critique en dépassant la CA (§207)", async () => {
  const { beatsAcBy } = await import("../module/scripts/core/attack.mjs");
  const { hitChance } = await import("../module/scripts/core/hitchance.mjs");
  it("un coup qui touche et dépasse la CA de l'écart devient critique ; désactivé à 0", () => {
    expect(beatsAcBy({ hit: true, critical: false, ac: 12 }, { total: 22 }, 10)).toBe(true);
    expect(beatsAcBy({ hit: true, critical: false, ac: 12 }, { total: 21 }, 10)).toBe(false);
    expect(beatsAcBy({ hit: true, critical: false, ac: 12 }, { total: 30 }, 0)).toBe(false);
    expect(beatsAcBy({ hit: false, critical: false, ac: 12 }, { total: 30 }, 10)).toBe(false);
    expect(beatsAcBy({ hit: true, critical: false, ac: null }, { total: 30 }, 10)).toBe(false);
  });
  it("les chances de critique comptent l'écart", () => {
    const base = hitChance({ ac: 10, bonus: 10 });
    const withMargin = hitChance({ ac: 10, bonus: 10, margin: 10 });
    expect(withMargin.hit).toBeCloseTo(base.hit, 6);
    // d20 + 10 ≥ 20 : 10 à 19 (dix faces) en plus du 20 naturel.
    expect(withMargin.critical).toBeCloseTo(11 / 20, 6);
    expect(base.critical).toBeCloseTo(1 / 20, 6);
  });
});

import { exclusiveWeaponHindrances } from "../module/scripts/core/attack.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

describe("O8e (§348) : Désavantage avec les autres armes", () => {
  const rules = [{ item: "axe", name: "Hache du berserker", active: true }, { item: "bow", name: "Arc du serment", active: false }];
  it("une autre arme : le Désavantage de chaque règle active", () => {
    expect(exclusiveWeaponHindrances(rules, "sword")).toEqual(["Hache du berserker"]);
  });
  it("l'arme elle-même, une attaque qui n'est pas d'arme ou une règle inactive : rien", () => {
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
  it("un 19 au seuil abaissé ne touche pas d'office : raté, l'Inspiration reste proposée", () => {
    const champion = roll(24, { isCritical: true, natural: 19 });
    expect(hitsRegardless(champion)).toBe(false);
    // Ce que lit `inspiredAttack` (runtime/engine-messages.mjs) ensuite : la cible ratée, donc l'offre.
    expect(resolveAttack(champion, [{ ...gobelin, ac: 25 }]).filter(t => t.reason === "miss")).toHaveLength(1);
    // Le dé d'Inspiration ajouté (+2) : le même 19 devient un coup critique.
    expect(resolveAttack({ ...champion, total: 26 }, [{ ...gobelin, ac: 25 }])[0]).toMatchObject({ hit: true, critical: true });
  });
  it("un 20 naturel, ou un critique sans d20 noté, touche d'office ; un jet ordinaire ou un 1 naturel, non", () => {
    expect(hitsRegardless(roll(21, { isCritical: true, natural: 20 }))).toBe(true);
    expect(hitsRegardless(roll(21, { isCritical: true }))).toBe(true);
    expect(hitsRegardless(roll(21))).toBe(false);
    expect(hitsRegardless(roll(6, { isFumble: true }))).toBe(false);
  });
});

describe("attackMark : ce que la carte annonce du jet", () => {
  const champion = roll(24, { isCritical: true, natural: 19 });
  it("un 19 au seuil abaissé qui rate n'est pas annoncé critique ; le même qui touche, si", () => {
    expect(attackMark(champion, resolveAttack(champion, [{ ...gobelin, ac: 25 }]))).toBe(null);
    expect(attackMark(champion, resolveAttack(champion, [{ ...gobelin, ac: 25 }, { ...ogre }]))).toBe("critical");
  });
  it("sans verdict (carte sans résolution) : annoncé, comme le fait le système", () => {
    expect(attackMark(champion)).toBe("critical");
  });
  it("20 naturel : critique même si le verdict manque ou l'écarte ; 1 naturel : échec ; jet ordinaire : rien", () => {
    expect(attackMark(roll(21, { isCritical: true, natural: 20 }), [])).toBe("critical");
    expect(attackMark(roll(6, { isFumble: true, natural: 1 }))).toBe("fumble");
    expect(attackMark(roll(17, { natural: 12 }), [])).toBe(null);
  });
});
