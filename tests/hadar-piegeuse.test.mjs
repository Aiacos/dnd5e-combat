/** §80: Hunger of Hadar (a sibling activity per area moment) and Ensnaring Strike (damage at the Restrained one's turn start). */
import { describe, it, expect } from "vitest";
import { siblingFor, hitKey, siblingsByMoment, shouldTrigger, markHit, openArea, pulseFor, pulseTargets } from "../module/scripts/core/area.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";

describe("one sibling activity per moment", () => {
  it("siblingsByMoment: only when they differ", () => {
    expect(siblingsByMoment([{ on: ["turnStart"], activity: "cold" }, { on: ["turnEnd"], activity: "acid" }])).toEqual({ turnStart: "cold", turnEnd: "acid" });
    expect(siblingsByMoment([{ on: ["enter", "turnEnd"], activity: "save" }])).toBeNull();   // Cordon of Arrows
    expect(siblingsByMoment([{ on: ["enter", "turnEnd"], activity: null }])).toBeNull();     // Rayon de lune
  });
  it("siblingFor: the one for the moment, otherwise the only one", () => {
    const hadar = { activity: "acid", activities: { turnStart: "cold", turnEnd: "acid" } };
    expect(siblingFor(hadar, "turnStart")).toBe("cold");
    expect(siblingFor(hadar, "turnEnd")).toBe("acid");
    expect(siblingFor({ activity: "save" }, "enter")).toBe("save");
    expect(siblingFor({ activity: null }, "enter")).toBeNull();
  });
  it("the cold of the start of the turn does not prevent the acid of the end, each once per turn", () => {
    const area = { ...openArea(["turnStart", "turnEnd"], "1-0"), activities: { turnStart: "cold", turnEnd: "acid" } };
    const at = event => ({ event, token: hitKey(area, event, "T"), turnKey: "1-0" });
    const afterStart = { ...area, ...markHit(area, at("turnStart")) };
    expect(shouldTrigger(afterStart, at("turnEnd"))).toBe(true);
    expect(shouldTrigger(afterStart, at("turnStart"))).toBe(false);
  });
  it("an area with a single activity keeps \"once per turn\" (Moonbeam)", () => {
    const area = openArea(["enter", "turnEnd"], "1-0");
    const ctx = event => ({ event, token: hitKey(area, event, "T"), turnKey: "1-0" });
    const after = { ...area, ...markHit(area, ctx("enter")) };
    expect(shouldTrigger(after, ctx("turnEnd"))).toBe(false);
  });
});

describe("contenu", () => {
  it("Faim de Hadar", () => {
    expect(CONTENT["hunger-of-hadar"].triggers).toEqual([
      { on: "turnStart", do: [{ type: "replay", activity: "G6bH5mBR3kkEYjYe" }] },
      { on: "turnEnd", do: [{ type: "replay", activity: "FGDyvqQz5JQQc5mf" }] }
    ]);
    expect(validateEntry(CONTENT["hunger-of-hadar"])).toEqual([]);
  });
  it("Ensnaring Strike: damage at the start of the turn, and the escape by someone else remains", () => {
    expect(CONTENT["ensnaring-strike"].triggers).toEqual([{ on: "startOfTurn", via: "effect", fromEffect: "tFGMG3cjQTEeAhv2",
      do: [{ type: "damage", to: "bearer", activity: "ZWId9mbOE9zFnP6f" }] }]);
    expect(CONTENT["ensnaring-strike"].actionEnds).toEqual({ tFGMG3cjQTEeAhv2: { by: "other", roll: "check" } });
    expect(CONTENT["ensnaring-strike"].noDamage).toEqual(["dnd5eactivity000"]);   // §81: no damage on cast
    expect(validateEntry(CONTENT["ensnaring-strike"])).toEqual([]);
  });
});

describe("noDamage (§81)", () => {
  it("list of 16-character activity ids", () => {
    expect(validateEntry({ noDamage: ["dnd5eactivity000"] })).toEqual([]);
    expect(validateEntry({ noDamage: [] }).length).toBeGreaterThan(0);
    expect(validateEntry({ noDamage: ["court"] }).length).toBeGreaterThan(0);
    expect(validateEntry({ noDamage: "dnd5eactivity000" }).length).toBeGreaterThan(0);
  });
});

describe("Wall of Thorns (§85)", () => {
  it("entry and end of turn: the sibling \"Traversal Save\", once per turn", () => {
    expect(CONTENT["wall-of-thorns"].triggers).toEqual([{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dMiM7Qec4keU3w7B" }] }]);
    expect(validateEntry(CONTENT["wall-of-thorns"])).toEqual([]);
  });
});

describe("Holy Aura (§86)", () => {
  it("aura: Advantage on saves, allies and self, as long as the spell holds", () => {
    const aura = CONTENT["holy-aura"].aura;
    expect(aura).toMatchObject({ whileActive: true, includeSelf: true, affects: "ally", radius: 30, units: "ft" });
    expect(aura.changes.map(c => c.key)).toContain("system.abilities.con.save.roll.mode");
  });
  it("Disadvantage for attackers, save of a Fiend or an Undead that hits in melee", () => {
    const [disadvantage, retaliation] = CONTENT["holy-aura"].triggers;
    expect(disadvantage).toMatchObject({ on: "preAttackRoll", via: "effect", do: [{ type: "disadvantage" }] });
    expect(retaliation).toEqual({ on: "isHit", via: "effect", if: { "activity.isMelee": true, "source.creatureType": ["fiend", "undead"] },
      do: [{ type: "save", to: "source", activity: "0kylpwRauH0WgW0G" }] });
    const facts = { "target.hasEffect": true, "activity.isMelee": true, "source.creatureType": true };
    expect(validateEntry(CONTENT["holy-aura"], { facts })).toEqual([]);
  });
  it("save step: toward the source, one activity", () => {
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "save", to: "source", activity: "0kylpwRauH0WgW0G" }] }] })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "save", to: "bearer", activity: "0kylpwRauH0WgW0G" }] }] }).length).toBeGreaterThan(0);
    expect(validateEntry({ triggers: [{ on: "isHit", do: [{ type: "save", to: "source" }] }] }).length).toBeGreaterThan(0);
  });
});

describe("template supplied by the content: Yolande, sylvan beings (§86)", () => {
  it("selfZone and zoneAffects, validated", () => {
    const facts = {};
    for ( const id of ["yolandes-regal-presence", "conjure-woodland-beings"] ) {
      expect(CONTENT[id].zoneAffects).toBe("enemy");
      expect(Object.values(CONTENT[id].selfZone)[0]).toEqual({ type: "radius", size: 10, units: "ft" });
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    }
    expect(CONTENT["yolandes-regal-presence"].triggers[1]).toEqual({ on: "failedSave", do: [{ type: "status", status: "prone" }, { type: "move", mode: "push", distance: 10, units: "ft", upTo: true }] });
  });
  it("refus", () => {
    expect(validateEntry({ selfZone: { court: { type: "radius", size: 10, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ selfZone: { dnd5eactivity000: { type: "cone", size: 10, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ selfZone: { dnd5eactivity000: { type: "radius", size: 0, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ zoneAffects: "everyone" }).length).toBeGreaterThan(0);
  });
});

describe("touch maneuvers (§87)", () => {
  const facts = { "target.hasEffect": true, "target.hasEffectFrom": true, "source.hasEffect": true, "source.hasEffectFromTarget": true };
  for ( const id of ["disarming-attack", "distracting-strike", "goading-attack", "menacing-attack", "pushing-attack", "trip-attack", "maneuvering-attack"] ) {
    it(id, () => {
      expect(CONTENT[id].hitRider).toMatchObject({ pays: "combat-superiority", weaponDamage: true });
      expect(validateEntry(CONTENT[id], { facts })).toEqual([]);
    });
  }
  it("pushing and tripping: size Large at most; taunting: the save without damage", () => {
    expect(CONTENT["pushing-attack"].hitRider.sizeAtMost).toBe("lg");
    expect(CONTENT["trip-attack"].triggers).toEqual([{ on: "failedSave", do: [{ type: "status", status: "prone" }] }]);
    expect(CONTENT["goading-attack"].noDamage).toEqual(["YZDchvLnuCD6xMkF"]);
  });
  it("pays: a string, not with slot", () => {
    expect(validateEntry({ hitRider: { pays: "combat-superiority", damage: "mlUC7IiS8ZyTvDpZ" } })).toEqual([]);
    expect(validateEntry({ hitRider: { pays: "combat-superiority", slot: "pact" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ hitRider: { pays: "" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ hitRider: { weaponDamage: "oui" } }).length).toBeGreaterThan(0);
  });
});

describe("Battle Master's Parry and Riposte (§88)", () => {
  it("the PHB's Parry has its own identifier; the Monster Manual's does not change", async () => {
    const { SOURCE_IDENTIFIERS } = await import("../module/scripts/content/sources.mjs");
    expect(SOURCE_IDENTIFIERS.phbmnvParry00000).toBe("parry-maneuver");
    expect(CONTENT["parry-maneuver"].triggers[0].do).toEqual([{ type: "use", activity: "F4UxiihGgkdv4orJ" }, { type: "reduce" }]);
    expect(CONTENT.parry.triggers[0].do).toEqual([{ type: "use" }, { type: "penalty", formula: "@prof" }]);
  });
  it("Riposte: use toward the source, with the weapon", () => {
    expect(CONTENT.riposte.triggers).toEqual([{ on: "isMissed", if: { "activity.isMelee": true },
      do: [{ type: "use", target: "source", activity: "QhxT9ZuZXmHGlrnT", weapon: true }] }]);
    expect(validateEntry(CONTENT.riposte, { facts: { "activity.isMelee": true } })).toEqual([]);
    expect(validateEntry({ triggers: [{ on: "isMissed", do: [{ type: "use", weapon: true }] }] }).length).toBeGreaterThan(0);
  });
});

describe("Bonus Action maneuvers (§89)", () => {
  it("Lunge, Feint, Evasive Footwork", () => {
    expect(CONTENT["lunging-attack"]).toMatchObject({ basicActions: { aoTn3UKohm5VAuIT: "dash" }, noDamage: ["aoTn3UKohm5VAuIT"], pendingDie: { activity: "aoTn3UKohm5VAuIT", against: "melee" } });
    expect(CONTENT["feinting-attack"].pendingDie).toEqual({ activity: "Utu8uaZOMepShbyw", against: "target" });
    expect(CONTENT["evasive-footwork"]).toMatchObject({ basicActions: { d3RqzIKzhqX82OwP: "disengage" }, rolledAc: { activity: "d3RqzIKzhqX82OwP", effect: "rGEvj6OHUjHan8pq" } });
    for ( const id of ["lunging-attack", "feinting-attack", "evasive-footwork"] ) expect(validateEntry(CONTENT[id], { facts: { "target.hasEffectFrom": true } })).toEqual([]);
  });
  it("refus", () => {
    expect(validateEntry({ pendingDie: { activity: "aoTn3UKohm5VAuIT", against: "ranged" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ pendingDie: { activity: "court", against: "melee" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ rolledAc: { activity: "d3RqzIKzhqX82OwP" } }).length).toBeGreaterThan(0);
  });
});

describe("the rest of the maneuvers (§90)", () => {
  it("Precision Attack, Ambush, \"Natural Authority\", Tactical Assessment: rollBonus", () => {
    expect(CONTENT["precision-attack"].rollBonus).toEqual({ activity: "WrckriM4bPU6NS38", on: ["attack"] });
    expect(CONTENT.ambush.rollBonus).toEqual({ activity: "HiargkiZgN4q8kg6", on: ["check", "initiative"], skills: ["ste"] });
    expect(CONTENT["commanding-presence"].rollBonus.skills).toEqual(["itm", "prf", "per"]);
    expect(CONTENT["tactical-assessment"].rollBonus.skills).toEqual(["his", "inv", "ins"]);
  });
  it("Sweeping Attack, Bait and Switch, Commander's Strike", () => {
    expect(CONTENT["sweeping-attack"]).toEqual({ sweep: { activity: "P9XWzKIH1sEvsOtC" } });
    expect(CONTENT["bait-and-switch"]).toEqual({ swapPlaces: { activity: "nYe2l7Rml0qyFbf6" }, rolledAc: { activity: "nYe2l7Rml0qyFbf6", effect: "8HUDgkIN8xvG2BAm", to: "choose" } });
    expect(CONTENT["commanders-strike"]).toEqual({ replacesAttack: true, noDamage: ["spcp6PQ8947Ds4Qg"], commandStrike: { activity: "spcp6PQ8947Ds4Qg" } });
    for ( const id of ["precision-attack", "ambush", "commanding-presence", "tactical-assessment", "sweeping-attack", "bait-and-switch", "commanders-strike"] ) {
      expect(validateEntry(CONTENT[id])).toEqual([]);
    }
  });
  it("refus", () => {
    expect(validateEntry({ sweep: { activity: "court" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ swapPlaces: { activity: "nYe2l7Rml0qyFbf6", distance: 5 } }).length).toBeGreaterThan(0);
    expect(validateEntry({ commandStrike: true }).length).toBeGreaterThan(0);
    expect(validateEntry({ rolledAc: { activity: "nYe2l7Rml0qyFbf6", effect: "8HUDgkIN8xvG2BAm", to: "other" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ rollBonus: { activity: "WrckriM4bPU6NS38", on: ["attack"], skills: "ste" } }).length).toBeGreaterThan(0);
  });
});

describe("spells on the caster's turn (§91)", () => {
  it("pulseFor: the entry that covers the replay number", () => {
    const rule = CONTENT["storm-of-vengeance"].casterPulse;
    expect(pulseFor(rule, 1).activity).toBe("WOo8u0FLAzNMpMJN");
    expect(pulseFor(rule, 2)).toMatchObject({ activity: "Fd8ZGgmDyNmJJuj3", max: 6 });
    expect(pulseFor(rule, 3).activity).toBe("H4uCtCkANBkttnov");
    expect(pulseFor(rule, 4).activity).toBe("yt2oWWelZl1zV4CB");
    expect(pulseFor(rule, 9).activity).toBe("yt2oWWelZl1zV4CB");
    expect(pulseFor(rule, 10)).toBeNull();
  });
  it("pulseTargets: the caster's enemies first, capped", () => {
    const t = [{ n: "a", disposition: 1 }, { n: "b", disposition: -1 }, { n: "c", disposition: -1 }, { n: "d", disposition: 1 }];
    expect(pulseTargets(t, 1, 2).map(x => x.n)).toEqual(["b", "c"]);
    expect(pulseTargets(t, 1, 3).map(x => x.n)).toEqual(["b", "c", "a"]);
    expect(pulseTargets(t, 1).map(x => x.n)).toEqual(["b", "c", "a", "d"]);
  });
  it("the content of the six spells is valid", () => {
    for ( const id of ["storm-of-vengeance", "earthquake", "delayed-blast-fireball", "tsunami", "symbol", "forbiddance"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "activity.id": true, "source.hasEffect": true } }), id).toEqual([]);
    }
    expect(CONTENT.earthquake.triggers[0].do).toEqual([{ type: "status", status: "prone" }, { type: "breakConcentration" }]);
    expect(CONTENT["delayed-blast-fireball"].zoneEnd).toEqual({ activity: "M15GlfjeWy7Cdiqn" });
    expect(CONTENT.forbiddance.selfZone.T2XK004SAb09LvvP.type).toBe("cube");
  });
  it("refus", () => {
    const by = [{ from: 1, activity: "WOo8u0FLAzNMpMJN" }];
    expect(validateEntry({ casterPulse: { at: "turnEnd", by } })).toEqual([]);
    expect(validateEntry({ casterPulse: { at: "round", by } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by: [] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by: [{ from: 0, activity: "WOo8u0FLAzNMpMJN" }] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by: [{ from: 3, to: 2, activity: "WOo8u0FLAzNMpMJN" }] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ casterPulse: { at: "turnEnd", by, away: { distance: -5, units: "ft" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ zoneEnd: { activity: "court" } }).length).toBeGreaterThan(0);
  });
});

describe("Steps of the Fey, Misty Escape, Avenging Angel (§92)", () => {
  it("contenu", () => {
    expect(CONTENT["steps-of-the-fey"].afterTeleport.options.slice(0, 2)).toEqual([{ activity: "QUbshQXhUDQqlu2s" }, { activity: "48TdRWDqCVcC9mh4", around: "left" }]);
    expect(CONTENT["misty-escape"].saveDamage).toEqual({ kj8zIhPbjs4UIHtc: "none" });
    expect(CONTENT["avenging-angel"].emanation).toMatchObject({ on: "turnStart", affects: "enemy", radiusFormula: "@scale.paladin.aura", whileActive: true });
    for ( const id of ["steps-of-the-fey", "misty-escape", "avenging-angel"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "source.hasEffect": true, "source.hasEffectFromTarget": true, "target.hasEffect": true } }), id).toEqual([]);
    }
  });
  it("refus", () => {
    expect(validateEntry({ afterTeleport: { spells: [], options: [{ activity: "QUbshQXhUDQqlu2s" }] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ afterTeleport: { spells: ["misty-step"], options: [{ activity: "QUbshQXhUDQqlu2s", around: "near" }] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ saveDamage: { kj8zIhPbjs4UIHtc: "full" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ emanation: { on: "turnStart", radiusFormula: "@scale.paladin.aura" } }).length).toBeGreaterThan(0);   // no unit
    expect(validateEntry({ emanation: { on: "turnStart", whileActive: "oui" } }).length).toBeGreaterThan(0);
  });
});

describe("Dons sombres : 1 naturel (§93)", async () => {
  const { rolledNaturalOne } = await import("../module/scripts/core/natural-one.mjs");
  it("the kept d20 is 1", () => {
    expect(rolledNaturalOne([{ d20: { total: 1 } }])).toBe(true);
    expect(rolledNaturalOne([{ d20: { total: 2 } }])).toBe(false);
    expect(rolledNaturalOne([{ d20: { total: 14 } }, { d20: { total: 1 } }])).toBe(true);
    expect(rolledNaturalOne([])).toBe(false);
    expect(rolledNaturalOne(null)).toBe(false);
  });
  it("contenu", async () => {
    const { SOURCE_IDENTIFIERS } = await import("../module/scripts/content/sources.mjs");
    expect(SOURCE_IDENTIFIERS.rhwWatchersGH8OL).toBe("watchers");
    for ( const id of ["aberrant-anatomy", "echoing-soul", "living-shadow", "symbiotic-being", "watchers"] ) {
      expect(CONTENT[id].onNatural1?.activity, id).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(validateEntry(CONTENT[id], { facts: { "source.hasEffect": true } }), id).toEqual([]);
    }
    expect(validateEntry({ onNatural1: { activity: "court" } }).length).toBeGreaterThan(0);
  });
});

describe("Ravenloft feats and species (§94)", () => {
  it("contenu valide", () => {
    for ( const id of ["gathered-whispers", "symbiotic-being", "survivor-ravenloft", "mist-walker", "sharp-eye-ravenloft", "knowledge-from-a-past-life", "lupin-howl", "feral-pounce", "watchers"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "source.hasEffect": true } }), id).toEqual([]);
    }
    expect(CONTENT["survivor-ravenloft"].rollBonus).toEqual({ activity: "9wAIIWcBr8lwp7Rm", on: ["save"], statuses: ["charmed", "frightened"] });
    expect(CONTENT["feral-pounce"].hitRider).toEqual({ save: "rW3uaSjC7gS5YQnM", item: "feral-pounce", oncePerTurn: true });
    expect(CONTENT.watchers.searchBonus).toEqual({ formula: "1d4" });
  });
  it("refus", () => {
    expect(validateEntry({ searchBonus: {} }).length).toBeGreaterThan(0);
    expect(validateEntry({ searchBonus: { advantage: "oui" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ rollBonus: { activity: "9wAIIWcBr8lwp7Rm", on: ["save"], statuses: [] } }).length).toBeGreaterThan(0);
  });
});

describe("sous-classes de Ravenloft (§95)", () => {
  it("contenu valide", () => {
    for ( const id of ["form-of-dread", "necrotic-husk", "wails-from-the-grave", "ghost-walk", "power-of-shadow", "shadow-walk", "wrath-of-the-wild", "ancient-might"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "target.hasEffect": true, "target.hasStatus": true, "activity.isAttack": true, "target.within": true, "target.seesSource": true, "self.hasEffect": true, "source.nearSelf": true, "self.seesSource": true } }), id).toEqual([]);
    }
    expect(CONTENT["power-of-shadow"].atZero).toEqual({ activity: "EmL9RVBiEFBPk2Cf", save: { ability: "cha", dc: "5 + @damage" } });
    expect(CONTENT["wrath-of-the-wild"].emanation.on).toBe("ownTurnStart");
    expect(CONTENT["form-of-dread"].hitRider.whileActive).toBe(true);
  });
  it("refus", () => {
    expect(validateEntry({ atZero: { activity: "court" } }).length).toBeGreaterThan(0);
    expect(validateEntry({ atZero: { activity: "EmL9RVBiEFBPk2Cf", save: { ability: "cha" } } }).length).toBeGreaterThan(0);
    expect(validateEntry({ afterSneak: { activity: "UxZzzGtEv93Yfs6H", radius: 30 } }).length).toBeGreaterThan(0);
    expect(validateEntry({ hitRider: { save: "Oqz9j7aHHPnRKdD9", whileActive: "oui" } }).length).toBeGreaterThan(0);
  });
});

describe("College of Spirits (§96)", () => {
  it("contenu valide", () => {
    for ( const id of ["avenger-spirit", "brute-spirit", "coward-spirit", "fortune-teller-spirit", "priest-spirit", "shade-spirit", "empowered-channeling"] ) {
      expect(validateEntry(CONTENT[id], { facts: { "activity.isMelee": true, "source.hasEffect": true, "activity.classSpell": true, "activity.cantripOf": true, "activity.type": true } }), id).toEqual([]);
    }
    expect(CONTENT["coward-spirit"].effectStatuses).toEqual({ HKUw9TEea19fIOjW: ["frightened"] });
    expect(CONTENT["avenger-spirit"].noDamage).toEqual(["bUvbdWWaJyHezUM8"]);
  });
  it("refus", () => {
    expect(validateEntry({ effectStatuses: { HKUw9TEea19fIOjW: [] } }).length).toBeGreaterThan(0);
    expect(validateEntry({ effectStatuses: { court: ["frightened"] } }).length).toBeGreaterThan(0);
  });
});

describe("§435: the Monster Manual's \"Submersion\" is not the Dungeon Master's Guide's \"Whelm\" hammer", () => {
  it("own identifier, no shipped entry: only the text layer (damage at the start of the Elemental's turn) applies", async () => {
    const { SOURCE_IDENTIFIERS } = await import("../module/scripts/content/sources.mjs");
    expect(SOURCE_IDENTIFIERS.mmWhelm000000000).toBe("mm-whelm");
    expect(CONTENT["mm-whelm"]).toBeUndefined();
    expect(CONTENT.whelm?.triggers?.[0]?.fromEffect).toBe("esmyGn6aLpCfWsFm");
  });

  it("the \"Submersion\" text gives the damage at the start of the turn of the creature that placed it", async () => {
    const { monsterRecurring } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>While Grappled, the target takes [[/damage average activity=khxVwH3AB0sx1qRG]] damage at the start of each of the elemental's turns.</p>";
    expect(monsterRecurring(html, [{ id: "rN76liiHkUoMRMJN", statuses: ["grappled", "restrained"] }]).triggers)
      .toEqual([{ on: "originTurnStart", via: "effect", do: [{ type: "damage", to: "bearer", activity: "khxVwH3AB0sx1qRG" }] }]);
  });
});
