/** §258: generic endings (`endsWhen`) raised by the CAT / CPR audit — pure decisions, schema, shipped content. */
import { describe, it, expect } from "vitest";
import { armorEnds, isReplayUsage, tooFarApart, nobodyAffected, zeroHpEnds } from "../module/scripts/core/endings.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

const target = (over={}) => ({ unaffected: null, hit: null, save: null, ...over });

describe("generic endings — decisions", () => {
  it("armor: any armor, or heavy only; a shield does not count", () => {
    expect(armorEnds("any", "light")).toBe(true);
    expect(armorEnds("any", "shield")).toBe(false);
    expect(armorEnds("heavy", "medium")).toBe(false);
    expect(armorEnds("heavy", "heavy")).toBe(true);
  });

  it("distance: strictly beyond the limit", () => {
    expect(tooFarApart(60, 60)).toBe(false);
    expect(tooFarApart(65, 60)).toBe(true);
    expect(tooFarApart(NaN, 60)).toBe(false);
  });

  it("§275: a replay (repeated save, area, reroll) does not judge \"nobody affected\"", () => {
    expect(isReplayUsage({ resave: { effect: "x", moment: "turnStart" } })).toBe(true);
    expect(isReplayUsage({ areaTick: { event: "turnEnd" } })).toBe(true);
    expect(isReplayUsage({ recast: true })).toBe(true);
    expect(isReplayUsage({ resolution: {} })).toBe(false);
    expect(isReplayUsage(undefined)).toBe(false);
  });

  it("nobody affected: all the saves succeeded", () => {
    const saved = { targets: [target({ save: { success: true } }), target({ save: { success: true } })] };
    expect(nobodyAffected(saved, "failedSave")).toBe(true);
    const one = { targets: [target({ save: { success: true } }), target({ save: { success: false } })] };
    expect(nobodyAffected(one, "failedSave")).toBe(false);
  });

  it("a save not yet judged decides nothing; an unaffectable target does not count", () => {
    expect(nobodyAffected({ targets: [target()] }, "failedSave")).toBe(false);
    const immune = { targets: [target({ unaffected: { reason: "type" } }), target({ save: { success: true } })] };
    expect(nobodyAffected(immune, "failedSave")).toBe(true);
    expect(nobodyAffected({ targets: [target({ unaffected: { reason: "immune" } })] }, "noTargets")).toBe(true);
  });

  it("aucun coup au but", () => {
    expect(nobodyAffected({ targets: [target({ hit: false }), target({ hit: false })] }, "noHits")).toBe(true);
    expect(nobodyAffected({ targets: [target({ hit: false }), target({ hit: true })] }, "noHits")).toBe(false);
  });
});

describe("zeroHp — who drops to 0 HP (issue #150)", () => {
  it("true and either: the bearer or the caster", () => {
    for ( const rule of [true, "either"] ) {
      expect(zeroHpEnds(rule, { isBearer: true })).toBe(true);
      expect(zeroHpEnds(rule, { isCaster: true })).toBe(true);
      expect(zeroHpEnds(rule, {})).toBe(false);
    }
  });
  it("caster: a warded creature at 0 HP stays warded (Warding Bond)", () => {
    expect(zeroHpEnds("caster", { isCaster: true })).toBe(true);
    expect(zeroHpEnds("caster", { isBearer: true })).toBe(false);
  });
  it("bearer: only the bearer", () => {
    expect(zeroHpEnds("bearer", { isBearer: true })).toBe(true);
    expect(zeroHpEnds("bearer", { isCaster: true })).toBe(false);
  });
  it("absent or unknown: never", () => {
    expect(zeroHpEnds(undefined, { isBearer: true, isCaster: true })).toBe(false);
    expect(zeroHpEnds("nobody", { isBearer: true, isCaster: true })).toBe(false);
  });
});

describe("generic endings — schema", () => {
  it("accepte les quatre fins et `spell`", () => {
    expect(validateEntry({ endsWhen: { armor: "any" } })).toEqual([]);
    expect(validateEntry({ endsWhen: { apart: { distance: 30, units: "ft", at: "casterTurnEnd" }, zeroHp: true, spell: true } })).toEqual([]);
    expect(validateEntry({ endsWhen: { unaffected: "noHits" } })).toEqual([]);
    for ( const who of ["bearer", "caster", "either"] ) expect(validateEntry({ endsWhen: { zeroHp: who } })).toEqual([]);
  });
  it("refuse le reste", () => {
    expect(validateEntry({ endsWhen: {} })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { armor: "shield" } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { apart: { distance: 0, units: "ft" } } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { apart: { distance: 30, units: "ft", at: "never" } } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { unaffected: "nobody" } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { later: true } })).toHaveLength(1);
    expect(validateEntry({ endsWhen: { zeroHp: "nobody" } })).toHaveLength(1);
  });
});

describe("generic endings — shipped content", () => {
  it("Mage Armor, Rage, Warding Bond, Compelled Duel", () => {
    expect(CONTENT["mage-armor"].endsWhen).toEqual({ armor: "any" });
    expect(CONTENT["rage"].endsWhen).toEqual({ armor: "heavy" });
    expect(CONTENT["rage"].rage).toBeTruthy();
    expect(CONTENT["warding-bond"].endsWhen).toEqual({ apart: { distance: 60, units: "ft" }, zeroHp: "caster", spell: true });
    expect(CONTENT["warding-bond"].triggers).toBeTruthy();
    expect(CONTENT["compelled-duel"].endsWhen.apart.at).toBe("casterTurnEnd");
    expect(CONTENT["compelled-duel"].endsWhen.casterTargetsOther).toBe(true);
    expect(CONTENT["compelled-duel"].endsWhen.allyDamages).toBe(true);
    expect(CONTENT["compelled-duel"].triggers).toBeTruthy();
  });
  it("saving-throw spells with Concentration end when nobody is affected", () => {
    for ( const id of ["hold-person", "banishment", "slow", "hypnotic-pattern", "polymorph"] ) {
      expect(CONTENT[id].endsWhen?.unaffected).toBe("failedSave");
      // §302: Hypnotic Pattern spares a Blinded creature (`target.hasStatus`).
      expect(validateEntry(CONTENT[id], { facts: { "target.hasStatus": true } })).toEqual([]);
    }
  });
});

describe("§259: summons that vanish at 0 HP", () => {
  it("summon spells, Giant Insect, \"Faithful Steed\", Unseen Servant", () => {
    for ( const id of ["summon-beast", "summon-undead", "giant-insect", "find-steed", "unseen-servant"] ) {
      expect(CONTENT[id].summon.vanishesAtZero).toBe(true);
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
    expect(CONTENT["find-steed"].summon.replaces).toBe(true);
    expect(CONTENT["animate-objects"].summon.vanishesAtZero).toBeUndefined();
  });
  it("schema: true or absent", () => {
    expect(validateEntry({ summon: { initiative: "after", vanishesAtZero: "oui" } })).toHaveLength(1);
  });
});

describe("§259: Guardian of Faith, damage cap", () => {
  it("60 damage in total", () => {
    expect(CONTENT["guardian-of-faith"].summon.vanishesAfterDamage).toBe(60);
    expect(validateEntry(CONTENT["guardian-of-faith"])).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", vanishesAfterDamage: 0 } })).toHaveLength(1);
  });
});

describe("§261: Difficult Terrain left by an instantaneous area", () => {
  it("Ice Storm, until the end of the caster's next turn", () => {
    expect(CONTENT["ice-storm"].difficultTerrain).toEqual({ lingers: "casterNextTurnEnd" });
    expect(validateEntry(CONTENT["ice-storm"])).toEqual([]);
    expect(validateEntry({ difficultTerrain: { lingers: "forever" } })).toHaveLength(1);
  });
});

describe("§262: Banishing Smite, save under 50 HP", () => {
  it("content and schema", () => {
    expect(CONTENT["banishing-smite"].smite.saveAtMostHp).toBe(50);
    expect(validateEntry(CONTENT["banishing-smite"])).toEqual([]);
    expect(validateEntry({ smite: { damage: "CXmmXBTfen6D6LXY", saveAtMostHp: -1 } })).toHaveLength(1);
  });
});

describe("§263: \"each creature of your choice\" — the allies spared", () => {
  it("Destructive Wave, Word of Radiance, \"Barrage Fire\", \"Volley\"", () => {
    for ( const id of ["destructive-wave", "word-of-radiance", "conjure-barrage", "conjure-volley"] ) expect(CONTENT[id].zoneAffects).toBe("enemy");
  });
});

describe("§264: teleportation with a passenger", () => {
  it("Dimension Door takes along a creature at 1.50 m", () => {
    expect(CONTENT["dimension-door"].teleport.passengers).toEqual({ count: 1, within: 5, units: "ft" });
    expect(validateEntry(CONTENT["dimension-door"])).toEqual([]);
    expect(validateEntry({ teleport: { distance: 30, units: "ft", passengers: { count: 0 } } })).toHaveLength(1);
  });
});

describe("§265: actual Banishment", () => {
  it("the \"Banished\" effects declared", () => {
    expect(CONTENT["banishment"].banishes).toEqual(["nwne4bDtD4pSWWPM"]);
    expect(CONTENT["banishing-smite"].banishes).toEqual(["dAnHnTaGvsiN1WzK"]);
    expect(CONTENT["banishing-smite"].smite.saveAtMostHp).toBe(50);
    expect(validateEntry({ banishes: ["court"] })).toHaveLength(1);
  });
});

describe("§266: Fire Shield sheds light", () => {
  it("3 m of Bright Light, 3 m of Dim Light", () => {
    expect(CONTENT["fire-shield"].light).toEqual({ on: "effect", bright: 10, dim: 20, units: "ft" });
    expect(CONTENT["fire-shield"].choice).toBeTruthy();
    expect(validateEntry({ light: CONTENT["fire-shield"].light })).toEqual([]);
  });
});

describe("§267 : Lenteur, une seule attaque", () => {
  it("contenu", () => {
    expect(CONTENT["slow"].singleAttack).toBe(true);
    expect(CONTENT["slow"].actionOrBonus).toBe(true);
    expect(validateEntry({ singleAttack: "oui" })).toHaveLength(1);
  });
});

describe("§268: Protection from Evil and Good wards off Charmed and Frightened", () => {
  it("content and schema", () => {
    expect(CONTENT["protection-from-evil-and-good"].wardsConditions.statuses).toEqual(["charmed", "frightened"]);
    expect(CONTENT["protection-from-evil-and-good"].wardsConditions.types).toContain("fiend");
    expect(CONTENT["protection-from-evil-and-good"].triggers).toBeTruthy();
    expect(validateEntry({ wardsConditions: { types: ["dragonkin"], statuses: ["charmed"] } })).toHaveLength(1);
  });
});

describe("§269 : Forme gazeuse, ni attaque ni sort", () => {
  it("contenu", () => {
    expect(CONTENT["gaseous-form"].noAttacksOrSpells).toBe(true);
    expect(CONTENT["gaseous-form"].actionEnds).toBeTruthy();
  });
});

describe("§273: \"Protection Smite\"", () => {
  it("the effect placed after a Divine Smite, the aura it lights, its end", () => {
    const e = CONTENT["smite-of-protection"];
    expect(e.afterSmite).toEqual({ effect: "EyWEQv8qPwbXyDmA", smites: ["divine-smite"] });
    expect(e.effectEnds).toEqual({ EyWEQv8qPwbXyDmA: "casterTurnStart" });
    expect(e.aura.whileActive).toBe(true);
    expect(validateEntry({ afterSmite: { effect: "court" } })).toHaveLength(1);
  });
});
