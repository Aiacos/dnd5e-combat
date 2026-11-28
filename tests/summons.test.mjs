import { describe, it, expect } from "vitest";
import { initiativeAfter } from "../module/scripts/core/turn.mjs";
import { classify } from "../module/scripts/core/combat-launch.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { summonOwnership, summonChoices, asksSummonForm, profilesAtLevel, countChoices, mmActorId, srdMonsterId, asksProfile, actorIdOf } from "../module/scripts/core/summon.mjs";

describe("Initiative of a summoned creature (§16.13)", () => {
  it("just below the summoner, above the next one", () => {
    expect(initiativeAfter(15, [18, 12, 15])).toBe(14.99);
    expect(initiativeAfter(15, [18])).toBe(14.99);
  });
  it("a very close next one: half the gap", () => {
    expect(initiativeAfter(15, [14.99])).toBe(14.995);
  });
});

import { planCommand, castCommand, currentCommand, nextPlayableTurn } from "../module/scripts/core/pilot.mjs";

describe("controlled object (§16.15, B19): commands", () => {
  const T = "c.2.0";
  it("the first move of the turn opens a command and pays for it", () => {
    expect(planCommand(null, "move", "bonus", T)).toEqual({ pay: "bonus", next: { turn: T, paid: true, move: true, used: 0 } });
    expect(planCommand(null, "use", "bonus", T)).toEqual({ pay: "bonus", next: { turn: T, paid: true, move: false, used: 1 } });
  });
  it("move then attack: a single Bonus Action; the attack ends the move", () => {
    const { next } = planCommand(null, "move", "bonus", T);
    const second = planCommand(next, "move", "bonus", T);
    expect(second.pay).toBeNull();
    const attack = planCommand(second.next, "use", "bonus", T);
    expect(attack).toEqual({ pay: null, next: { turn: T, paid: true, move: false, used: 1 } });
    expect(planCommand(attack.next, "move", "bonus", T).pay).toBe("bonus");   // "move... then act": the Sphere stops
  });
  it("une seconde attaque demande une nouvelle commande", () => {
    const { next } = planCommand(null, "use", "bonus", T);
    expect(planCommand(next, "use", "bonus", T).pay).toBe("bonus");
  });
  it("the state of another turn does not count", () => {
    const old = { turn: "c.1.0", paid: true, move: true, used: 0 };
    expect(currentCommand(old, T)).toBeNull();
    expect(planCommand(old, "move", "bonus", T).pay).toBe("bonus");
  });
  it("on casting: the Spiritual Weapon attacks without moving, the Hand moves and acts", () => {
    const weapon = castCommand("use", T);
    expect(planCommand(weapon, "use", "bonus", T).pay).toBeNull();
    expect(planCommand(weapon, "move", "bonus", T).pay).toBe("bonus");
    const hand = castCommand("command", T);
    expect(planCommand(hand, "move", "bonus", T).pay).toBeNull();
    expect(castCommand(undefined, T)).toBeNull();
  });
});

describe("controlled object: skipped turn", () => {
  it("moves forward to the next, back to the previous", () => {
    expect(nextPlayableTurn([false, true, false], 1, 1)).toBe(2);
    expect(nextPlayableTurn([false, true, false], 1, -1)).toBe(0);
    expect(nextPlayableTurn([false, true, true, false], 1, 1)).toBe(3);
    expect(nextPlayableTurn([false, false], 1, 1)).toBe(1);
  });
  it("at the edge of the round, goes out of bounds", () => {
    expect(nextPlayableTurn([false, true], 1, 1)).toBe(2);
  });
});

describe("controlled object: schema", () => {
  it("accepte pilot et endsSpell", () => {
    expect(validateEntry({ summon: { initiative: "after", endsSpell: true, pilot: { cost: "bonus", distance: 20, units: "ft", onCast: "use" } } })).toEqual([]);
  });
  it("refuse ce qui cloche", () => {
    expect(validateEntry({ summon: { initiative: "after", endsSpell: 1, pilot: { cost: "reaction", distance: -1, units: "", onCast: "x", speed: 3 } } })).toEqual([
      "summon.endsSpell: true or absent", "summon.pilot.cost: action, bonus, free", "summon.pilot.distance: non-negative number",
      "summon.pilot.units: unit required", "summon.pilot.onCast: use, command", "summon.pilot.speed: unknown key"
    ]);
  });
});

describe("Flaming Sphere and Bigby's Hand (§16.15): schema", () => {
  it("pulse, endsAtZero, occupies", () => {
    expect(validateEntry({ summon: { initiative: "after", endsAtZero: true, pulse: { item: "flames", radius: 5, units: "ft" }, pilot: { cost: "bonus", distance: 60, units: "ft", occupies: false } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "after", endsAtZero: 1, pulse: { item: "", radius: 0, units: "", at: 1 }, pilot: { cost: "bonus", distance: 60, units: "ft", occupies: true } } })).toEqual([
      "summon.endsAtZero: true or absent", "summon.pulse.item: item identifier required", "summon.pulse.radius: positive number",
      "summon.pulse.units: unit required", "summon.pulse.at: unknown key", "summon.pilot.occupies: false or absent"
    ]);
  });
  it("push: distance as a formula, the source that follows", () => {
    const push = d => validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", units: "ft", ...d }] }] });
    expect(push({ distance: "5 + 5 * @flags.dnd5e.summon.mod", follow: true })).toEqual([]);
    expect(push({ distance: " ", follow: "oui" })).toEqual(["triggers[0].do[0].distance: positive number or formula", "triggers[0].do[0].follow: boolean"]);
  });
});

describe("Arcane Eye and Dancing Lights (§16.17): schema", () => {
  it("Initiative \"none\", shared command, cluster, leash", () => {
    expect(validateEntry({ summon: { initiative: "none", pilot: { cost: "bonus", distance: 60, units: "ft", shared: true, cluster: { distance: 20, units: "ft" }, leash: true } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", pilot: { cost: "bonus", distance: 60, units: "ft", shared: 1, cluster: { distance: 0 }, leash: "oui" } } })).toEqual([
      "summon.pilot.shared: true or absent", "summon.pilot.leash: true or absent", "summon.pilot.cluster: { distance, units }"
    ]);
  });
});

describe("Summon Beast (§16.22): schema", () => {
  it("pilot free, pulse on/affects", () => {
    expect(validateEntry({ summon: { initiative: "none", pilot: { cost: "free", distance: 30, units: "ft" }, pulse: { item: "pack-damage", radius: 10, units: "ft", on: ["turnEnd", "enter", "moves"], affects: "enemy" } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", pulse: { item: "x", radius: 10, units: "ft", on: ["start"], affects: "ally" } } })).toEqual([
      "summon.pulse.on: turnEnd, enter, moves, turnStart, casterTurnStart", "summon.pulse.affects: any, enemy"
    ]);
  });

  it("pulse seenBy (§368)", () => {
    expect(validateEntry({ summon: { initiative: "none", pulse: { item: "pack-damage", radius: 10, units: "ft", seenBy: "caster" } } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "none", pulse: { item: "x", radius: 10, units: "ft", seenBy: true } } })).toEqual([
      "summon.pulse.seenBy: caster"
    ]);
    expect(CONTENT["conjure-animals"].summon.pulse.seenBy).toBe("caster");
  });
});

describe("owners of a creature summoned by the GM (§197)", () => {
  const isGM = id => id === "gm";
  it("the players who own the caster become owners of the creature", () => {
    expect(summonOwnership({ default: 0, gm: 3, alice: 3, bob: 2 }, { default: 0, gm: 3 }, isGM)).toEqual({ default: 0, gm: 3, alice: 3 });
  });
  it("nothing to change: already an owner, or no player owner", () => {
    expect(summonOwnership({ default: 0, gm: 3, alice: 3 }, { default: 0, alice: 3 }, isGM)).toBe(null);
    expect(summonOwnership({ default: 3, gm: 3 }, { default: 0, gm: 3 }, isGM)).toBe(null);
  });
  it("a level below Owner on the creature is raised", () => {
    expect(summonOwnership({ alice: 3 }, { alice: 2 }, isGM)).toEqual({ alice: 3 });
  });
});


describe("O8f (§349) : invocations hostiles", () => {
  it("summon.hostile : true ou absent", () => {
    expect(validateEntry({ summon: { initiative: "own", hostile: true, vanishesAtZero: true } })).toEqual([]);
    expect(validateEntry({ summon: { initiative: "own", hostile: "yes" } }).length).toBe(1);
  });
});

describe("§383: choosing the form of a summon (issue #38)", () => {
  it("plusieurs profils, tailles ou types : un choix", () => {
    expect(summonChoices({ profiles: 2 })).toEqual({ profile: true, size: false, type: false, any: true });
    expect(summonChoices({ profiles: 1, types: 3 })).toMatchObject({ profile: false, type: true, any: true });
    expect(summonChoices({ profiles: 3, sizes: 5 })).toMatchObject({ profile: true, size: true });
  });
  it("a single form, or none: nothing to choose", () => {
    expect(summonChoices({ profiles: 1, sizes: 1, types: 1 }).any).toBe(false);
    expect(summonChoices({ profiles: 0, sizes: 4 }).any).toBe(false);
    expect(summonChoices().any).toBe(false);
  });
  const two = summonChoices({ profiles: 2 });
  it("asked when the dnd5e dialog is skipped (action bar) and something will be summoned", () => {
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true })).toBe(true);
  });
  it("not when dnd5e shows its dialog: its \"Profile\" choice is enough", () => {
    expect(asksSummonForm({ configure: true, choices: two, willSummon: true })).toBe(false);
    expect(asksSummonForm({ configure: undefined, choices: two, willSummon: true })).toBe(false);
  });
  it("not when nothing will be summoned, already chosen, confirmed outright or chosen elsewhere", () => {
    expect(asksSummonForm({ configure: false, choices: two, willSummon: false })).toBe(false);
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true, chosen: true })).toBe(false);
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true, confirmed: true })).toBe(false);
    expect(asksSummonForm({ configure: false, choices: two, willSummon: true, otherChoice: true })).toBe(false);
  });
  it("une seule forme : jamais", () => {
    expect(asksSummonForm({ configure: false, choices: summonChoices({ profiles: 1 }), willSummon: true })).toBe(false);
  });
});

describe("§385: \"up to N\" creatures (Create Undead)", () => {
  it("the dialog always opens, even from the sheet, unless already chosen or confirmed", () => {
    const one = summonChoices({ profiles: 1 });
    expect(asksSummonForm({ configure: true, choices: one, willSummon: true, always: true })).toBe(true);
    expect(asksSummonForm({ configure: true, choices: one, willSummon: true, always: true, chosen: true })).toBe(false);
    expect(asksSummonForm({ configure: true, choices: one, willSummon: true, always: true, confirmed: true })).toBe(false);
    expect(asksSummonForm({ configure: true, choices: one, willSummon: false, always: true })).toBe(false);
  });
  const profiles = [{ _id: "goule", level: { min: null, max: null } }, { _id: "blême", level: { min: 8, max: null } },
    { _id: "momie", level: { min: 9, max: null } }];
  it("les formes permises suivent le niveau", () => {
    expect(profilesAtLevel(profiles, 6).map(p => p._id)).toEqual(["goule"]);
    expect(profilesAtLevel(profiles, 8).map(p => p._id)).toEqual(["goule", "blême"]);
    expect(profilesAtLevel(profiles, 9).map(p => p._id)).toEqual(["goule", "blême", "momie"]);
    expect(profilesAtLevel([{ _id: "x", level: { min: 3, max: 5 } }], 6)).toEqual([]);
  });
  it("from 1 to N; nothing to choose below 2", () => {
    expect(countChoices(3)).toEqual([1, 2, 3]);
    expect(countChoices(1)).toEqual([]);
    expect(countChoices(0)).toEqual([]);
    expect(countChoices(null)).toEqual([]);
  });
});

describe("§386: creatures from the 2024 Monster Manual rather than the 2014 SRD", () => {
  it("the Monster Manual identifier from the English name", () => {
    expect(mmActorId("Ghoul")).toBe("mmGhoul000000000");
    expect(mmActorId("Wight")).toBe("mmWight000000000");
    expect(mmActorId("Ogre Zombie")).toBe("mmOgreZombie0000");
    expect(mmActorId("Ghast Gravecaller")).toBe("mmGhastGravecall");
    expect(mmActorId("")).toBeNull();
  });
  it("only recognizes the dnd5e 2014 SRD monster compendium", () => {
    expect(srdMonsterId("Compendium.dnd5e.monsters.Actor.OBujQLLPSmlJiZnL")).toBe("OBujQLLPSmlJiZnL");
    expect(srdMonsterId("Compendium.dnd5e.monsters.OBujQLLPSmlJiZnL")).toBe("OBujQLLPSmlJiZnL");
    expect(srdMonsterId("Compendium.dnd5e.actors24.Actor.OBujQLLPSmlJiZnL")).toBeNull();
    expect(srdMonsterId("Compendium.dnd-players-handbook.actors.Actor.phbcesAngelSpiri")).toBeNull();
    expect(srdMonsterId(null)).toBeNull();
  });
});

describe("§391: enchantment or transformation profile without the dnd5e dialog", () => {
  it("asked when the dialog is skipped and there are several profiles", () => {
    expect(asksProfile({ configure: false, profiles: 3 })).toBe(true);
  });
  it("not with the dnd5e dialog, a single profile, already chosen, confirmed or Wild Shape", () => {
    expect(asksProfile({ configure: true, profiles: 3 })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 1 })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 3, chosen: true })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 3, confirmed: true })).toBe(false);
    expect(asksProfile({ configure: false, profiles: 3, own: true })).toBe(false);
  });
});

describe("§392: the id of an actor at the end of a link (broken DMG links)", () => {
  it("formes longue et courte", () => {
    expect(actorIdOf("Compendium.dnd-dungeon-masters-guide.actors.Actor.sApYLZj9PTZ40wJr")).toBe("sApYLZj9PTZ40wJr");
    expect(actorIdOf("Compendium.dnd5e.actors24.phbmobWeasel0000")).toBe("phbmobWeasel0000");
    expect(actorIdOf("Actor.sApYLZj9PTZ40wJr")).toBeNull();
    expect(actorIdOf(null)).toBeNull();
  });
});

describe("§394: targeted summons", () => {
  it("seul Doigt de mort se vise d'un clic ; les autres invocations non", async () => {
    const { CONTENT } = await import("../module/scripts/content/index.mjs");
    expect(CONTENT["finger-of-death"]?.targetedSummon).toBe(true);
    for ( const id of ["create-undead", "animate-dead", "animate-objects", "summon-celestial"] ) expect(CONTENT[id]?.targetedSummon).toBeUndefined();
  });
});

describe("images, sensors and objects placed by a spell: outside combat (SRD 5.2)", () => {
  const still = ["silent-image", "major-image", "programmed-illusion", "project-image", "mislead", "clairvoyance", "scrying",
    "tensers-floating-disk", "secret-chest", "light", "continual-flame"];

  it("each declares that it does not join combat, and the entry validates", () => {
    for ( const id of still ) {
      expect(CONTENT[id]?.summon?.initiative, id).toBe("none");
      expect(validateEntry({ summon: CONTENT[id].summon }), id).toEqual([]);
    }
  });

  it("the casting dialog does not offer a \"none\" summon; without the declaration, it offered it", () => {
    const token = summon => ({ id: "t", uuid: "Scene.s.Token.t", name: "Image", img: "", actorKey: "a", player: false,
      online: false, creature: true, alive: true, sameLevel: true, notCombatant: false, summon, master: null, seen: false,
      hiddenToken: false });
    const listed = summon => Object.values(classify([token(summon)])).flat().length;
    expect(listed("none")).toBe(0);
    expect(listed("own")).toBe(1);
  });
});

describe("SRD 5.2 magic item summons: their place in combat", () => {
  const rule = id => CONTENT[id]?.summon?.initiative;
  it("the four other Horns of Valhalla, like the silver one: their own Initiative", () => {
    for ( const id of ["brass-horn-of-valhalla", "bronze-horn-of-valhalla", "iron-horn-of-valhalla", "horn-of-valhalla"] ) {
      expect(rule(id), id).toBe(rule("silver-horn-of-valhalla"));
    }
    expect(rule("silver-horn-of-valhalla")).toBe("own");
  });
  it("djinni, efreeti, Flask creature, Pipes swarms: their own Initiative", () => {
    for ( const id of ["ring-of-djinni-summoning", "efreeti-bottle", "iron-flask", "pipes-of-the-sewers"] ) {
      expect(rule(id), id).toBe("own");
    }
  });
  it("the snake of the Staff of the Python: right after its master", () => {
    expect(rule("staff-of-the-python")).toBe("after");
  });
  it("whip, dancing sword, image, carpet: outside combat", () => {
    for ( const id of ["whip-feather-token", "dancing-sword", "deck-of-illusions", "carpet-of-flying"] ) {
      expect(rule(id), id).toBe("none");
    }
  });
  it("each entry validates", () => {
    for ( const id of ["brass-horn-of-valhalla", "staff-of-the-python", "dancing-sword", "efreeti-bottle"] ) {
      expect(validateEntry({ summon: CONTENT[id].summon }), id).toEqual([]);
    }
  });
});
