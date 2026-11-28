import { dataFixPlan } from "../module/scripts/core/data-fixes.mjs";
import { describe, it, expect } from "vitest";
import { twiceKeepHighest, rerollOnesOnce, swapPartners } from "../module/scripts/core/feats.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { eligibleReactions } from "../module/scripts/core/reaction.mjs";
import { SHIPPED } from "../module/scripts/content/index.mjs";

describe("§129 : Sauvagerie martiale", () => {
  it("each dice term rolled twice, the best kept; the modifier does not move", () => {
    expect(twiceKeepHighest("1d12 + @mod")).toBe("{1d12,1d12}kh + @mod");
    expect(twiceKeepHighest("2d6min3 + 3")).toBe("{2d6min3,2d6min3}kh + 3");
  });
});

describe("§129: Healer", () => {
  it("a 1 rerolled once; a term that already rerolls is not touched", () => {
    expect(rerollOnesOnce("2d8 + @mod")).toBe("2d8r1 + @mod");
    expect(rerollOnesOnce("1d8r1 + @prof")).toBe("1d8r1 + @prof");
  });
});

describe("§129 : Vigilant", () => {
  const me = { id: "a", disposition: 1, initiative: 12 };
  it("allies on the same side who have their Initiative, neither Incapacitated nor prone", () => {
    const others = [me, { id: "b", disposition: 1, initiative: 18 }, { id: "c", disposition: -1, initiative: 20 },
      { id: "d", disposition: 1, initiative: null }, { id: "e", disposition: 1, initiative: 5, incapacitated: true }];
    expect(swapPartners(me, others)).toEqual(["b"]);
  });
  it("Incapacitated: no swap", () => {
    expect(swapPartners({ ...me, incapacitated: true }, [{ id: "b", disposition: 1, initiative: 18 }])).toEqual([]);
  });
});

describe("§129: schema", () => {
  it("the shipped feats validate", () => {
    for ( const id of ["tavern-brawler", "savage-attacker", "lucky", "alert", "healer"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
  });
  it("boon: shove and bare hands", () => {
    expect(validateEntry({ hitRider: { push: { distance: 5, units: "ft" }, unarmed: true } })).toEqual([]);
    expect(validateEntry({ hitRider: { push: { distance: 0, units: "ft" } } }).length).toBe(1);
  });
  it("rollBonus.spellAttack: true, and only for an attack roll; \"Seeking Spell\" declares it", () => {
    const seeking = { activity: "vudKvHh2PbAiDXSE", on: ["attack"], reroll: {}, spellAttack: true };
    expect(validateEntry({ rollBonus: seeking })).toEqual([]);
    expect(SHIPPED["seeking-spell"].rollBonus).toEqual(seeking);
    expect(validateEntry({ rollBonus: { ...seeking, on: ["save"] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ rollBonus: { ...seeking, spellAttack: "oui" } }).length).toBeGreaterThan(0);
  });

  it("rollBonus.luck, and the true keys", () => {
    expect(validateEntry({ rollBonus: { activity: "DEX2YgxfqdMse2bT", on: ["attack"], luck: true } })).toEqual([]);
    expect(validateEntry({ savageAttacker: "oui" }).length).toBe(1);
  });
});

describe("§129: a `free` window does not ask for the Reaction", () => {
  const declared = [{ name: "Bouclier", on: ["isAttacked"] }, { name: "Chanceux", on: ["isAttacked"], free: true }];
  it("Reaction taken: only the free window remains", () => {
    expect(eligibleReactions(declared, "isAttacked", { reactionAvailable: false }).map(r => r.name)).toEqual(["Chanceux"]);
  });
  it("Incapacitated: nothing", () => {
    expect(eligibleReactions(declared, "isAttacked", { reactionAvailable: true, incapacitated: true })).toEqual([]);
  });
});

describe("§129 : fusion", () => {
  it("the feats' keys survive the merge of the shipped content", () => {
    expect(SHIPPED["savage-attacker"].savageAttacker).toBe(true);
    expect(SHIPPED["alert"].initiativeSwap).toBe(true);
    expect(SHIPPED["healer"].healingRerolls).toBe(true);
    expect(SHIPPED["lucky"].rollBonus.luck).toBe(true);
    expect(SHIPPED["tavern-brawler"].hitRider.push).toEqual({ distance: 5, units: "ft" });
  });
});

import { effectHolds, sameChanges } from "../module/scripts/core/feats.mjs";

describe("§130 : effets de don conditionnels", () => {
  const facts = (o={}) => ({ armor: null, weapons: [], inCombat: false, abilities: { dex: 14 }, ...o });
  it("Defense: only in armor", () => {
    const rule = SHIPPED["defense"].effectWhile.W0ObItz7sS8ZJ09Y.if;
    expect(effectHolds(rule, facts())).toBe(false);
    expect(effectHolds(rule, facts({ armor: "medium" }))).toBe(true);
  });
  it("Dueling: a one-handed melee weapon, no other", () => {
    const rule = SHIPPED["dueling"].effectWhile.VEodDUQvYPHhl0Ya.if;
    expect(effectHolds(rule, facts({ weapons: [{ melee: true, twoHanded: false }] }))).toBe(true);
    expect(effectHolds(rule, facts({ weapons: [{ melee: true, twoHanded: true }] }))).toBe(false);
    expect(effectHolds(rule, facts({ weapons: [{ melee: true, twoHanded: false }, { melee: true, twoHanded: false }] }))).toBe(false);
    expect(effectHolds(rule, facts({ weapons: [{ melee: false, twoHanded: false }] }))).toBe(false);
  });
  it("Medium Armor Master: medium armor and Dexterity 16", () => {
    const r = SHIPPED["medium-armor-master"].effectWhile.r6D3Ach1DcRanNcj;
    expect(effectHolds(r.if, facts({ armor: "medium", abilities: { dex: 16 } }))).toBe(true);
    expect(effectHolds(r.if, facts({ armor: "medium", abilities: { dex: 15 } }))).toBe(false);
    expect(sameChanges([{ key: "system.attributes.bonus", type: "add", value: 1 }], r.changes)).toBe(false);
    expect(sameChanges([{ key: "system.attributes.ac.bonus", type: "add", value: 1 }], r.changes)).toBe(true);
  });
  it("Skulker: in combat", () => {
    expect(effectHolds(SHIPPED["skulker"].effectWhile["6moNnOl0izLMgVNl"].if, facts({ inCombat: true }))).toBe(true);
  });
  it("schema", () => {
    for ( const id of ["defense", "dueling", "heavy-armor-master", "medium-armor-master", "skulker"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
    expect(validateEntry({ effectWhile: { W0ObItz7sS8ZJ09Y: { if: { armor: ["plate"] } } } }).length).toBe(1);
  });
});

import { rangedFeatsFor, coverLeft } from "../module/scripts/core/feats.mjs";

describe("§131 : dons de tir", () => {
  const ss = SHIPPED["sharpshooter"].rangedFeat, ce = SHIPPED["crossbow-expert"].rangedFeat, sp = SHIPPED["spell-sniper"].rangedFeat;
  const bow = { weapon: true, ranged: true, crossbow: false, spell: false };
  const handXbow = { weapon: true, ranged: true, crossbow: true, spell: false };
  const sword = { weapon: true, ranged: false, crossbow: false, spell: false };
  const bolt = { weapon: false, ranged: true, crossbow: false, spell: true };
  it("Sharpshooter: ranged weapon only", () => {
    expect(rangedFeatsFor([ss], bow)).toMatchObject({ cover: true, closeCombat: true, longRange: true });
    expect(rangedFeatsFor([ss], sword)).toMatchObject({ cover: false, closeCombat: false, longRange: false });
    expect(rangedFeatsFor([ss], bolt).cover).toBe(false);
  });
  it("Crossbow Expert: crossbow only", () => {
    expect(rangedFeatsFor([ce], handXbow)).toMatchObject({ closeCombat: true, offhandModifier: true, longRange: false });
    expect(rangedFeatsFor([ce], bow).closeCombat).toBe(false);
  });
  it("Sniper de sorts : jets d'attaque de sort", () => {
    expect(rangedFeatsFor([sp], bolt)).toMatchObject({ cover: true, closeCombat: true, spellRange: { value: 60, units: "ft" } });
    expect(rangedFeatsFor([sp], bow).cover).toBe(false);
  });
  it("l'abri total reste", () => {
    expect(coverLeft({ degree: "half", bonus: 2 }, true)).toBeNull();
    expect(coverLeft({ degree: "threeQuarters", bonus: 5 }, true)).toBeNull();
    expect(coverLeft({ degree: "total", bonus: null }, true)).toEqual({ degree: "total", bonus: null });
    expect(coverLeft({ degree: "half", bonus: 2 }, false)).toEqual({ degree: "half", bonus: 2 });
  });
  it("schema", () => {
    for ( const id of ["sharpshooter", "crossbow-expert", "spell-sniper"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
    expect(validateEntry({ rangedFeat: { kind: "bow" } }).length).toBe(1);
  });
});

import { oneMoreKeepBest } from "../module/scripts/core/feats.mjs";

describe("§132 : coups", () => {
  it("Piercer: one more die, the best kept; a pool or a \"kh\" left alone", () => {
    expect(oneMoreKeepBest("1d8 + @mod")).toBe("2d8kh1 + @mod");
    expect(oneMoreKeepBest("2d6min3")).toBe("3d6min3kh2");
    expect(oneMoreKeepBest("{1d8,1d8}kh + 3")).toBe("{1d8,1d8}kh + 3");
  });
  it("schema", () => {
    for ( const id of ["crusher", "piercer", "slasher", "charger", "shield-master", "unarmed-fighting"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
    expect(validateEntry(SHIPPED["grappler"], { facts: { "target.grappledBySource": true } })).toEqual([]);
    expect(validateEntry({ critMark: { damageType: "slashing", side: "up" } }).length).toBe(1);
    expect(validateEntry({ hitRider: { sizeAbove: -1 } }).length).toBe(1);
  });
});

describe("§133: feat reactions", () => {
  it("schema", () => {
    const facts = { "activity.isMelee": true, "target.wieldsProperty": true, "target.nearSelf": true, "target.isSelf": true, "self.hasShield": true,
      "self.seesSource": true, "target.hasEffect": true, "source.nearSelf": true };
    for ( const id of ["defensive-duelist", "protection", "mage-slayer", "sentinel", "shield-master"] ) expect(validateEntry(SHIPPED[id], { facts })).toEqual([]);
    expect(SHIPPED["mage-slayer"].rollBonus).toMatchObject({ succeed: true, abilities: ["int", "wis", "cha"] });
    expect(SHIPPED["sentinel"].haltOnReaction.effect).toBe("B0d2x2p98X9D3vRh");
    expect(SHIPPED["shield-master"].interposeShield).toBe(true);
    expect(validateEntry({ haltOnReaction: { effect: "court" } }).length).toBe(1);
  });
});

import { standUpCost } from "../module/scripts/core/turn.mjs";

describe("§134 : le reste", () => {
  it("Athlete: standing up for 1.50 m (at most half the Speed)", () => {
    expect(standUpCost({ speed: 30, remaining: 30, fixed: 5 }).cost).toBe(5);
    expect(standUpCost({ speed: 30, remaining: 30 }).cost).toBe(15);
    expect(standUpCost({ speed: 6, remaining: 30, fixed: 5 }).cost).toBe(3);
  });
  it("schema", () => {
    for ( const id of ["elemental-adept", "poisoner", "speedy", "athlete", "observant"] ) expect(validateEntry(SHIPPED[id])).toEqual([]);
    expect(SHIPPED["poisoner"].ignoresResistance.types).toEqual(["poison"]);
    expect(validateEntry({ quickStand: { value: 0, units: "ft" } }).length).toBe(1);
  });
});

describe("§135: epic boons", () => {
  it("Night Spirit: the Resistances in Dim Light or in Darkness", () => {
    const rule = SHIPPED["boon-of-the-night-spirit"].effectWhile.f6JofmGpxquX9bqb.if;
    const f = light => ({ armor: null, weapons: [], inCombat: false, abilities: {}, light });
    expect(effectHolds(rule, f("dim"))).toBe(true);
    expect(effectHolds(rule, f("dark"))).toBe(true);
    expect(effectHolds(rule, f("bright"))).toBe(false);
  });
  it("schema", () => {
    const facts = { "damage.resisted": true };
    for ( const id of ["boon-of-combat-prowess", "boon-of-energy-resistance", "boon-of-fate", "boon-of-fortitude", "boon-of-irresistible-offense",
      "boon-of-recovery", "boon-of-speed", "boon-of-spell-recall", "boon-of-the-night-spirit"] ) expect(validateEntry(SHIPPED[id], { facts })).toEqual([]);
    expect(validateEntry({ lastStandHeal: { activity: "x" } }).length).toBe(1);
    expect(validateEntry({ effectWhile: { f6JofmGpxquX9bqb: { if: { light: ["night"] } } } }).length).toBe(1);
  });
});

import { polearmFits } from "../module/scripts/core/feats.mjs";
import { entersAt, reachStrikers } from "../module/scripts/core/reaction.mjs";

describe("§136: Polearm Master, Reactive Strike", () => {
  it("staff, spear, or Heavy weapon with Reach", () => {
    expect(polearmFits({ baseItem: "quarterstaff", properties: ["ver"] })).toBe(true);
    expect(polearmFits({ baseItem: "spear", properties: [] })).toBe(true);
    expect(polearmFits({ baseItem: "glaive", properties: new Set(["hvy", "rch", "two"]) })).toBe(true);
    expect(polearmFits({ baseItem: "whip", properties: ["fin", "rch"] })).toBe(false);
    expect(polearmFits({ baseItem: "greatsword", properties: ["hvy", "two"] })).toBe(false);
  });
  it("entering the reach: from farther away to within range; already within range, it is not entering", () => {
    expect(entersAt([20, 15, 10, 5], 10)).toBe(2);
    expect(entersAt([10, 5], 10)).toBe(-1);
    expect(entersAt([20, 15], 10)).toBe(-1);
  });
  it("hostile, free Reaction, not Incapacitated; Disengage does not avoid it, teleportation does", () => {
    const o = { token: "A", disposition: -1, enters: 2, reactionAvailable: true };
    expect(reachStrikers({ disposition: 1, teleported: false }, [o])).toEqual(["A"]);
    expect(reachStrikers({ disposition: 1, teleported: true }, [o])).toEqual([]);
    expect(reachStrikers({ disposition: -1, teleported: false }, [o])).toEqual([]);
    expect(reachStrikers({ disposition: 1, teleported: false }, [{ ...o, reactionAvailable: false }])).toEqual([]);
    expect(reachStrikers({ disposition: 1, teleported: false }, [{ ...o, enters: -1 }])).toEqual([]);
    expect(reachStrikers({ disposition: 1, teleported: false }, [{ ...o, hasLineOfEffect: false }])).toEqual([]);
  });
  it("the declaration is valid", () => {
    expect(validateEntry(SHIPPED["polearm-master"])).toEqual([]);
    expect(SHIPPED["polearm-master"].reactiveStrike).toBe(true);
  });
});

describe("rangedFeat.cover \"half\": only half cover is ignored (Wand of the War Mage)", () => {
  const wand = { kind: "spell", cover: "half" };
  const bolt = { weapon: false, ranged: true, crossbow: false, spell: true };
  it("spell attack roll: \"half\"; weapon attack: nothing", () => {
    expect(rangedFeatsFor([wand], bolt).cover).toBe("half");
    expect(rangedFeatsFor([wand], { weapon: true, ranged: true, crossbow: false, spell: false }).cover).toBe(false);
  });
  it("a feat that also ignores three-quarters cover wins, in both orders", () => {
    const sniper = { kind: "spell", cover: true };
    expect(rangedFeatsFor([wand, sniper], bolt).cover).toBe(true);
    expect(rangedFeatsFor([sniper, wand], bolt).cover).toBe(true);
  });
  it("half cover falls away, three-quarters cover and Total Cover remain", () => {
    expect(coverLeft({ degree: "half", bonus: 2 }, "half")).toBeNull();
    expect(coverLeft({ degree: "threeQuarters", bonus: 5 }, "half")).toEqual({ degree: "threeQuarters", bonus: 5 });
    expect(coverLeft({ degree: "total", bonus: null }, "half")).toEqual({ degree: "total", bonus: null });
    expect(coverLeft({ degree: "threeQuarters", bonus: 5 }, true)).toBeNull();
  });
});

describe("effectWhile.notArmor and the speeds that depend on armor (SRD 5.2)", () => {
  const worn = armor => ({ armor, shield: false, weapons: [], inCombat: false, abilities: {} });
  it("notArmor: holds with no armor and under another armor, not under that one", () => {
    const rule = { notArmor: ["heavy"] };
    expect(effectHolds(rule, worn(null))).toBe(true);
    expect(effectHolds(rule, worn("light"))).toBe(true);
    expect(effectHolds(rule, worn("medium"))).toBe(true);
    expect(effectHolds(rule, worn("heavy"))).toBe(false);
    // A shield does not count as heavy armor.
    expect(effectHolds(rule, { ...worn(null), shield: true })).toBe(true);
  });
  it("Fast Movement and Roving: no heavy armor; Unarmored Movement: neither armor nor shield", () => {
    expect(SHIPPED["fast-movement"].effectWhile).toEqual({ Ln2upWfCALSwthX1: { if: { notArmor: ["heavy"] } } });
    expect(SHIPPED["roving"].effectWhile).toEqual({ J9RWCSmYGnP0fkn1: { if: { notArmor: ["heavy"] } } });
    const monk = SHIPPED["unarmored-movement"].effectWhile.OEYjH4cLYd0VPaKm.if;
    expect(effectHolds(monk, worn(null))).toBe(true);
    expect(effectHolds(monk, worn("light"))).toBe(false);
    expect(effectHolds(monk, { ...worn(null), shield: true })).toBe(false);
    for ( const id of ["fast-movement", "roving", "unarmored-movement"] ) expect(validateEntry(SHIPPED[id]), id).toEqual([]);
    expect(validateEntry({ effectWhile: { Ln2upWfCALSwthX1: { if: { notArmor: ["plates"] } } } }).length).toBeGreaterThan(0);
  });
  it("Roving: climbing and swimming leave the conditional effect for an effect that stays", () => {
    const data = [{ key: "system.attributes.movement.bonus", value: 10, type: "add", phase: "initial" },
      { key: "system.attributes.movement.speeds.climb", value: "@attributes.movement.speed", type: "upgrade", phase: "initial" },
      { key: "system.attributes.movement.speeds.swim", value: "@attributes.movement.speed", type: "upgrade", phase: "initial" }];
    const item = { effects: [{ _id: "J9RWCSmYGnP0fkn1", transfer: true, system: { changes: data } }], system: {} };
    const plan = dataFixPlan(item, SHIPPED["roving"].dataFixes);
    expect(plan.create.map(e => e._id)).toEqual(["dasRovingSpeeds0"]);
    expect(plan.create[0].system.changes.map(c => c.key)).toEqual(["system.attributes.movement.speeds.climb",
      "system.attributes.movement.speeds.swim"]);
    expect(plan.effects[0]["system.changes"].map(c => c.key)).toEqual(["system.attributes.movement.bonus"]);
  });
});
