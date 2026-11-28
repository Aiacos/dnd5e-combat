import { describe, it, expect } from "vitest";
import { masteryEffect, grazeDamage, toppleDC, cleaveModifier, markExpires, MASTERIES, masterySources, masterySlots, restChanges, removedCount,
  masteryVerdict, allowanceLeft, standingMastery, standingChoiceToStore } from "../module/scripts/core/mastery.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

const hit = { hit: true, damaged: true, melee: true, size: "med", down: false };
const miss = { ...hit, hit: false, damaged: false };

describe("§21 bottes d'arme : ce que fait chacune", () => {
  it("Graze: only on a miss", () => {
    expect(masteryEffect("graze", miss)).toBe("graze");
    expect(masteryEffect("graze", hit)).toBe(null);
  });
  it("Sap, Topple: on a hit; Slow, Vex: on a hit that deals damage", () => {
    expect(masteryEffect("sap", hit)).toBe("sap");
    expect(masteryEffect("topple", hit)).toBe("topple");
    expect(masteryEffect("slow", hit)).toBe("slow");
    expect(masteryEffect("vex", hit)).toBe("vex");
    expect(masteryEffect("slow", { ...hit, damaged: false })).toBe(null);
    expect(masteryEffect("vex", { ...hit, damaged: false })).toBe(null);
    for ( const m of ["sap", "topple", "slow", "vex", "push", "cleave"] ) expect(masteryEffect(m, miss)).toBe(null);
  });
  it("Push: size Large or smaller", () => {
    expect(masteryEffect("push", { ...hit, size: "lg" })).toBe("push");
    expect(masteryEffect("push", { ...hit, size: "huge" })).toBe(null);
  });
  it("Cleave: in melee, once per turn", () => {
    expect(masteryEffect("cleave", hit)).toBe("cleave");
    expect(masteryEffect("cleave", { ...hit, melee: false })).toBe(null);
    expect(masteryEffect("cleave", { ...hit, cleaveSpent: true })).toBe(null);
  });
  it("a target at 0 HP: nothing, except Cleave and Graze", () => {
    for ( const m of ["sap", "topple", "slow", "vex", "push"] ) expect(masteryEffect(m, { ...hit, down: true })).toBe(null);
    expect(masteryEffect("cleave", { ...hit, down: true })).toBe("cleave");
  });
  it("Coup double et inconnues : rien ici", () => {
    expect(masteryEffect("nick", hit)).toBe(null);
    expect(masteryEffect(null, hit)).toBe(null);
    expect(MASTERIES).toHaveLength(8);
  });
});

describe("§21 bottes d'arme : nombres", () => {
  it("Graze = the modifier, nothing if zero or negative", () => {
    expect(grazeDamage(4)).toBe(4);
    expect(grazeDamage(0)).toBe(0);
    expect(grazeDamage(-1)).toBe(0);
  });
  it("Topple: DC 8 + modifier + proficiency", () => expect(toppleDC(4, 2)).toBe(14));
  it("Cleave: without the modifier, unless it is negative", () => {
    expect(cleaveModifier(3)).toBe(0);
    expect(cleaveModifier(-1)).toBe(-1);
  });
});

describe("§21 marques : quand elles tombent", () => {
  const e = (moment, sourceTurn, turnKey=null) => ({ moment, sourceTurn, turnKey, placedOn: "c.1.0" });
  it("Sap and Slow: at the start of the attacker's next turn", () => {
    expect(markExpires("sap", e("turnStart", true))).toBe(true);
    expect(markExpires("slow", e("turnStart", true))).toBe(true);
    expect(markExpires("sap", e("turnEnd", true, "c.1.0"))).toBe(false);
    expect(markExpires("sap", e("turnStart", false))).toBe(false);
  });
  it("Vex: at the end of its next turn, not of the one where it was applied", () => {
    expect(markExpires("vex", e("turnEnd", true, "c.1.0"))).toBe(false);
    expect(markExpires("vex", e("turnEnd", true, "c.2.0"))).toBe(true);
    expect(markExpires("vex", e("turnStart", true))).toBe(false);
  });
});

import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("§21 Fighter: schema and content", () => {
  it("the new keys", () => {
    expect(validateEntry({ grantsAction: true, movesAfter: "second-wind", studiedAttacks: true, heroicWarrior: true, greatWeaponFighting: true, thrownDamage: 2 })).toEqual([]);
    expect(validateEntry({ movesAfter: "" })).toEqual(["movesAfter: item identifier, or { item, disengage? }"]);
    expect(validateEntry({ movesAfter: { item: "rage", disengage: false } })).toEqual([]);
    expect(validateEntry({ thrownDamage: 0 })).toEqual(["thrownDamage: positive integer"]);
  });
  it("the shipped content", () => {
    expect(CONTENT["action-surge"].grantsAction).toBe(true);
    expect(CONTENT["tactical-shift"].movesAfter).toBe("second-wind");
    expect(CONTENT["studied-attacks"].studiedAttacks).toBe(true);
    expect(CONTENT["thrown-weapon-fighting"].thrownDamage).toBe(2);
  });
  it("Studied Attacks fall like Vex", () => {
    expect(markExpires("studied", { moment: "turnEnd", sourceTurn: true, turnKey: "c.1.0", placedOn: "c.1.0" })).toBe(false);
    expect(markExpires("studied", { moment: "turnEnd", sourceTurn: true, turnKey: "c.2.0", placedOn: "c.1.0" })).toBe(true);
  });
});

describe("§22 Barbarian: schema, content, Recklessness", () => {
  it("the new keys", () => {
    expect(validateEntry({ rage: { effect: "G5XZTi4zYTFiHVll" }, persistentRage: true, reckless: true, relentless: { activity: "dnd5eactivity100" } })).toEqual([]);
    expect(validateEntry({ rage: { effect: "court" } })).toEqual(["rage: { effect } (effect id)"]);
    expect(validateEntry({ relentless: {} })).toEqual(["relentless: { activity } (activity id)"]);
  });
  it("the shipped content", () => {
    expect(CONTENT.rage.rage.effect).toBe("G5XZTi4zYTFiHVll");
    expect(CONTENT["instinctive-pounce"].movesAfter).toEqual({ item: "rage", disengage: false });
    expect(CONTENT.frenzy.triggers[0].oncePerTurn).toBe(true);
    expect(CONTENT["divine-fury"].triggers[0].do[0]).toEqual({ type: "damage", formula: "1d6 + floor(@classes.barbarian.levels / 2)", damageType: "radiant" });
  });
  it("Recklessness ends at the start of its next turn", () => {
    expect(markExpires("reckless", { moment: "turnStart", sourceTurn: true, turnKey: null, placedOn: "c.1.0" })).toBe(true);
    expect(markExpires("reckless", { moment: "turnEnd", sourceTurn: true, turnKey: "c.1.0", placedOn: "c.1.0" })).toBe(false);
  });
});

describe("§23 cantrips: schema and content", () => {
  it("the new keys", () => {
    expect(validateEntry({ effectEnds: { zwks0mAqBHGZC1Pk: "casterTurnEnd" }, blocksHealing: true, noOpportunityAttacks: true, oneAttack: true,
      byWounds: { healthy: "LFXYm5sLg6D3ZilN", wounded: "w9KUTNVoj3K8XSlv" }, breaksOn: ["save"] })).toEqual([]);
    expect(validateEntry({ effectEnds: { zwks0mAqBHGZC1Pk: "nextWeek" } }))
      .toEqual(["effectEnds.zwks0mAqBHGZC1Pk: casterTurnStart, casterTurnEnd, bearerTurnStart, bearerTurnEnd, currentTurnEnd"]);
    expect(validateEntry({ byWounds: { healthy: "LFXYm5sLg6D3ZilN" } })).toEqual(["byWounds: { healthy, wounded } (activity ids)"]);
  });
  it("the shipped content", () => {
    expect(CONTENT["chill-touch"]).toMatchObject({ blocksHealing: true, effectEnds: { zwks0mAqBHGZC1Pk: "casterTurnEnd" } });
    expect(CONTENT["ray-of-frost"].effectEnds).toEqual({ "7dnnwBMWLykrVJub": "casterTurnStart" });
    expect(CONTENT["mind-sliver"].breaksOn).toEqual(["save"]);
    expect(CONTENT["shocking-grasp"].noOpportunityAttacks).toBe(true);
    // Vicious Mockery keeps its consumed mark (§16.12) and gets its duration end.
    expect(CONTENT["vicious-mockery"].triggers[0].do.map(s => s.type)).toEqual(["disadvantage", "consume"]);
    expect(CONTENT["vicious-mockery"].effectEnds).toEqual({ suEeAQQXl0X2JqzF: "bearerTurnEnd" });
    expect(CONTENT.friends.targets.types).toEqual(["humanoid"]);
    expect(CONTENT["true-strike"]).toMatchObject({ enchantTarget: "ownWeapon", oneAttack: true });
  });
});

import { open, advance, applicationPlan, STEPS } from "../module/scripts/core/action.mjs";

describe("§24 Monk: Deflect Attacks and schema", () => {
  const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
  const base = RESOLUTION_BASE;
  const roll = total => ({ total, isCritical: false, isFumble: false });
  it("Deflect Attacks: the Reaction reduces the attack's damage by an amount (application plan)", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author" }, targets: [] });
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { canReact: true }), T(2)] }));
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Parade", ac: 12, reduce: 8 }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, reduced: 8 });
    ({ resolution } = advance(resolution, { type: "damageRolled", messageId: "d", damages: [{ type: "slashing", value: 9, properties: [] }] }));
    const plan = applicationPlan(resolution);
    expect(plan[0]).toMatchObject({ token: "T1", multiplier: 1, reduction: 8 });
    expect(plan[1].reduction).toBeUndefined();
  });
  it("the new keys", () => {
    expect(validateEntry({ martialArts: true, flurry: { activity: "2ghJTBhilLrFn9xT", strikes: 2 },
      stunningStrike: { activity: "Xto99a8Zt46VLwaR", focus: "monks-focus" }, openHand: { addle: "1jdSaWanuRrdkVs3" },
      basicActions: { "7xj7b6e8tDznDSrE": ["disengage", "dodge"] } })).toEqual([]);
    expect(validateEntry({ flurry: { activity: "2ghJTBhilLrFn9xT" } })).toEqual(["flurry: { activity, strikes, weapons? }"]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "reduce" }] }] }))
      .toEqual(["triggers[0].do: \"reduce\" requires the isHit or allyIsHit moment and a \"use\" reaction"]);
  });
  it("the shipped content", () => {
    // Two forms: paid (Handbook 2.2.0) and free (SRD 5.2, Handbook 3.0.0) — tests/basic-kinds.test.mjs.
    expect(CONTENT["monks-focus"].basicActions["0MuRZ0Ur95xQTKFq"]).toEqual({ paid: ["dash", "disengage"], free: "dash" });
    expect(CONTENT["deflect-attacks"].triggers[0].do.map(s => s.type)).toEqual(["use", "reduce"]);
    expect(CONTENT["stunning-strike"].savedEffects).toEqual(["cj9HhBNKtF6iOsH4"]);
  });
});

describe("§222 bottes choisies : places, changements au Repos long", () => {
  const fighter = { item: "f", label: "Guerrier 4", identifier: "fighter", kind: "class", classLevel: 4,
    advancements: [{ level: 1, count: 3 }, { level: 4, count: 1 }, { level: 10, count: 1 }, { level: 16, count: 1 }] };
  const barbarian = { item: "b", label: "Barbare 1", identifier: "barbarian", kind: "class", classLevel: 1,
    advancements: [{ level: 1, count: 2 }, { level: 4, count: 1 }] };
  const feat = { item: "w", label: "Maître d'armes", identifier: "weapon-master", kind: "feat", classLevel: null, advancements: [{ level: 0, count: 1 }] };
  const weapons = { greatsword: { melee: true, proficient: true }, flail: { melee: true, proficient: true },
    javelin: { melee: true, proficient: true }, longbow: { melee: false, proficient: true }, shortbow: { melee: false, proficient: true },
    whip: { melee: true, proficient: false } };

  it("a class counts its advancements up to its level; a feat, always", () => {
    const sources = masterySources([fighter, feat]);
    expect(sources.map(s => s.count)).toEqual([4, 1]);
    expect(masterySlots(sources)).toBe(5);
    expect(masterySlots(masterySources([{ ...fighter, classLevel: 16 }]))).toBe(6);
  });
  it("a source without a mastery property is ignored", () => {
    expect(masterySources([{ ...feat, advancements: [{ level: 0, count: 0 }] }])).toEqual([]);
  });
  it("Long Rest: the Fighter changes one, the Barbarian and the Weapon Master all of theirs", () => {
    expect(restChanges(masterySources([fighter]))).toBe(1);
    expect(restChanges(masterySources([barbarian, feat]))).toBe(3);
  });
  it("removed: those from before that are no longer chosen", () => {
    expect(removedCount(["a", "b", "c"], ["a", "d"])).toBe(2);
    expect(removedCount(["a"], ["a", "b"])).toBe(0);
  });
  it("no more mastery properties than slots", () => {
    const sources = masterySources([fighter]);
    expect(masteryVerdict({ before: [], after: ["greatsword", "flail", "javelin", "longbow"], weapons, sources }).ok).toBe(true);
    expect(masteryVerdict({ before: [], after: ["greatsword", "flail", "javelin", "longbow", "shortbow"], weapons, sources }).reason).toBe("tooMany");
  });
  it("a weapon not mastered cannot be added; an unknown weapon is judged only on the count", () => {
    const sources = masterySources([fighter]);
    expect(masteryVerdict({ before: [], after: ["whip"], weapons, sources }).reason).toBe("notProficient");
    expect(masteryVerdict({ before: ["whip"], after: ["whip"], weapons, sources }).ok).toBe(true);
    expect(masteryVerdict({ before: [], after: ["homebrew-blade"], weapons, sources }).ok).toBe(true);
  });
  it("Barbarian: melee weapons only, except slots from another source", () => {
    expect(masteryVerdict({ before: [], after: ["greatsword", "longbow"], weapons, sources: masterySources([barbarian]) }).reason).toBe("melee");
    expect(masteryVerdict({ before: [], after: ["greatsword", "longbow"], weapons, sources: masterySources([barbarian, feat]) }).ok).toBe(true);
  });
  it("replacing a mastery property requires what the Long Rest allows changing", () => {
    const sources = masterySources([fighter]);
    const before = ["greatsword", "flail", "javelin"];
    expect(masteryVerdict({ before, after: ["greatsword", "flail", "longbow"], weapons, sources }).reason).toBe("changes");
    expect(masteryVerdict({ before, after: ["greatsword", "flail", "longbow"], weapons, sources, allowance: 1 }).ok).toBe(true);
    expect(masteryVerdict({ before, after: ["greatsword", "longbow", "shortbow"], weapons, sources, allowance: 1 }).reason).toBe("changes");
    // Adding into a free slot, always allowed.
    expect(masteryVerdict({ before, after: [...before, "longbow"], weapons, sources }).ok).toBe(true);
  });
});

describe("§510 mastery window: what the Long Rest still lets you change (Discord, Fanarie)", () => {
  it("the choice in progress is deducted from the remaining entitlement", () => {
    expect(allowanceLeft(1, ["greatsword", "flail", "javelin"], ["greatsword", "flail", "javelin"])).toBe(1);
    expect(allowanceLeft(1, ["greatsword", "flail", "javelin"], ["greatsword", "flail", "longbow"])).toBe(0);
    expect(allowanceLeft(3, ["a", "b", "c"], ["a", "d", "e"])).toBe(1);
  });
  it("adding a mastery property in a free slot spends nothing; never negative; missing entitlement = 0", () => {
    expect(allowanceLeft(1, ["a"], ["a", "b"])).toBe(1);
    expect(allowanceLeft(1, ["a", "b"], [])).toBe(0);
    expect(allowanceLeft(undefined, ["a"], ["b"])).toBe(0);
  });
});

describe("§537 standing mastery per weapon (Tactical Master, issue #160)", () => {
  const options = ["sap", "push", "slow"];   // the weapon's own first, as dnd5e orders them
  it("uses the stored choice while the weapon offers it", () => {
    expect(standingMastery(options, "push")).toBe("push");
    expect(standingMastery(options, "slow")).toBe("slow");
  });
  it("falls back to the weapon's own mastery without a choice, or when the choice is no longer offered", () => {
    expect(standingMastery(options, null)).toBe("sap");
    expect(standingMastery(["sap"], "push")).toBe(null);
    expect(standingMastery(["graze", "push"], "slow")).toBe("graze");
  });
  it("nothing to choose: leaves dnd5e's default", () => {
    expect(standingMastery(null, "push")).toBe(null);
    expect(standingMastery([], "push")).toBe(null);
    expect(standingMastery(["sap"], null)).toBe(null);
  });
  it("stores nothing for the weapon's own mastery, refuses an option the weapon lacks", () => {
    expect(standingChoiceToStore(options, "sap")).toBe(null);
    expect(standingChoiceToStore(options, "push")).toBe("push");
    expect(standingChoiceToStore(options, "topple")).toBe(undefined);
    expect(standingChoiceToStore(null, "push")).toBe(undefined);
  });
});
