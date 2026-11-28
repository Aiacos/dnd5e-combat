import { describe, expect, it } from "vitest";
import { conditionsIn, monsterEndings, plainText, readEndings } from "../module/scripts/core/monster-text.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";

// Synthetic examples, reduced to the phrasings the reader recognizes (no book text).
const repeat = "Failure: The target has the Stunned condition and repeats the save at the end of each of its turns, ending the effect on itself on a success.";
const twoStep = "First Failure: The target has the Restrained condition and repeats the save at the end of its next turn if it is still Restrained. Second Failure: The target has the Petrified condition instead of the Restrained condition.";
const twoStepAlt = "Failure: The target has the Incapacitated condition until the end of its next turn, at which point it repeats the save. Second Failure: The target has the Unconscious condition for 10 minutes. This effect ends for the target if it takes damage.";
const damageEnds = "Failure: The target has the Charmed condition for 1 hour or until it takes damage.";

describe("K1: end of the conditions of a monster ability, read from its text", () => {
  it("makes the text readable (condition references, enrichers)", () => {
    expect(plainText("<p>has the &amp;Reference[Paralyzed apply=false] condition [[/damage 2d6]]</p>")).toBe("has the Paralyzed condition …");
    expect(conditionsIn("the Paralyzed and Poisoned conditions")).toEqual(["paralyzed", "poisoned"]);
  });

  it("save repeated at the end of each of its turns", () => {
    expect(readEndings(repeat)).toEqual({ resave: { on: "endOfTurn" }, endsOnDamage: false, resaveOnDamage: false });
    expect(readEndings("At the end of each of its turns, the target repeats the save, ending the effect on a success.").resave).toEqual({ on: "endOfTurn" });
    expect(readEndings("It repeats the Wisdom save at the start of each of its turns.").resave).toEqual({ on: "startOfTurn" });
  });

  it("first then second failure: counter, the second failure's condition", () => {
    expect(readEndings(twoStep).resave).toEqual({ on: "endOfTurn", tally: { successes: 1, failures: 1, status: "petrified" } });
    const alt = readEndings(twoStepAlt);
    expect(alt.resave).toEqual({ on: "endOfTurn", tally: { successes: 1, failures: 1, status: "unconscious" } });
    expect(alt.endsOnDamage).toBe(true);
  });

  it("end on damage, and save replayed on damage", () => {
    expect(readEndings(damageEnds).endsOnDamage).toBe(true);
    expect(readEndings("The condition ends if the target takes damage.").endsOnDamage).toBe(true);
    expect(readEndings("The target succeeds automatically after 10 minutes or if it takes damage.").endsOnDamage).toBe(true);
    // Only the second condition drops: not the whole effect.
    expect(readEndings("While Poisoned, it also has the Unconscious condition, which ends early if the target takes damage.").endsOnDamage).toBe(false);
    const r = readEndings("The target repeats the save whenever it takes damage, ending the effect on a success.");
    expect(r.resaveOnDamage).toBe(true);
  });

  it("valid content declarations, for any effect of the item when it has only one outcome", () => {
    const t = monsterEndings(`<p>${twoStepAlt}</p>`, [{ id: "a".repeat(16), statuses: ["incapacitated"] }]);
    expect(t).toEqual([
      { on: "endOfTurn", via: "effect", do: [{ type: "resave", tally: { successes: 1, failures: 1, status: "unconscious" } }] },
      { on: "isDamaged", via: "effect", do: [{ type: "remove" }] }
    ]);
    expect(validateEntry({ triggers: t })).toEqual([]);
    expect(monsterEndings("Hit: 7 damage.")).toEqual([]);
  });

  it("several outcomes: each rule applies only to the effect whose condition is named in its segment", () => {
    const html = `Rays. 1: Charm Ray. ${damageEnds} 2: Stunning Ray. ${repeat} 3: Fear Ray. Failure: The target has the Frightened condition for 1 minute.`;
    const effects = [{ id: "c".repeat(16), statuses: ["charmed"] }, { id: "s".repeat(16), statuses: ["stunned"] }, { id: "f".repeat(16), statuses: ["frightened"] }];
    expect(monsterEndings(html, effects)).toEqual([
      { on: "isDamaged", via: "effect", fromEffect: "c".repeat(16), do: [{ type: "remove" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "s".repeat(16), do: [{ type: "resave" }] }
    ]);
    // "First Roar. … Second Roar." is split too; "First Failure:" is not.
    const roars = `First Roar. Failure: The target has the Frightened condition for 1 minute. Second Roar. ${repeat}`;
    expect(monsterEndings(roars, effects)).toEqual([{ on: "endOfTurn", via: "effect", fromEffect: "s".repeat(16), do: [{ type: "resave" }] }]);
  });
});

describe("K2: the death that a monster ability's text promises", () => {
  it("death at 0 HP, restricted to a type or a size", async () => {
    const { monsterDeaths } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterDeaths("Hit: 9 damage. If this damage reduces the target to 0 Hit Points, it dies.")).toEqual({ killsAtZero: true });
    expect(monsterDeaths("Failure or Success: A Humanoid reduced to 0 Hit Points by this damage dies.")).toEqual({ killsAtZero: { types: ["humanoid"] } });
    expect(monsterDeaths("If this damage reduces a Medium or smaller creature to 0 Hit Points, the creature dies.")).toEqual({ killsAtZero: { sizeAtMost: "med" } });
    // Neither the bearer, nor a stabilization, nor an item.
    expect(monsterDeaths("The beast dies only if it starts its turn with 0 Hit Points.")).toEqual({});
    expect(monsterDeaths("If this damage reduces the target to 0 Hit Points, the target becomes Stable.")).toEqual({});
    expect(monsterDeaths("The tome turns to dust if reduced to 0 Hit Points.")).toEqual({});
  });

  it("HP thresholds: death or fall at 0 HP, damage above", async () => {
    const { monsterDeaths } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterDeaths("Failure: If the target has 20 Hit Points or fewer, it drops to 0 Hit Points. Otherwise, it takes 9 damage."))
      .toEqual({ hpTiers: [{ atMost: 20, damage: false, zero: true }, {}] });
    // The "Death" effect that the data places by default applies only under the threshold.
    const dead = "d".repeat(16);
    expect(monsterDeaths("If the creature has 80 Hit Points or fewer, it dies. Otherwise, it takes 40 damage.", { effects: [{ id: dead, statuses: ["dead"] }] }))
      .toEqual({ hpTiers: [{ atMost: 80, damage: false, statuses: ["dead"] }, { effects: [] }] });
  });

  it("a numbered ray: the rule applies only to its activity", async () => {
    const { monsterDeaths } = await import("../module/scripts/core/monster-text.mjs");
    const a = "a".repeat(16), b = "b".repeat(16);
    const html = "Rays. 1: Weak Ray. Failure: 9 damage. 2: Dust Ray. Failure: 20 damage. If the target is a creature and this damage reduces it to 0 Hit Points, it disintegrates into dust.";
    const r = monsterDeaths(html, { activities: [{ id: a, name: "1: Weak Ray" }, { id: b, name: "2 : Dust Ray" }] });
    expect(r).toEqual({ killsAtZero: { activities: [b] } });
    expect(validateEntry(r)).toEqual([]);
    expect(validateEntry({ hpTiers: [{ atMost: 20, damage: false, zero: true, activities: [b] }, { activities: [b] }] })).toEqual([]);
  });
});

describe("K3: only one of the effects, rolled or chosen", () => {
  const ids = ["c", "f", "p", "i"].map(c => c.repeat(16));
  const effects = [{ id: ids[3], statuses: ["incapacitated"] }, { id: ids[0], statuses: ["charmed"] }, { id: ids[2], statuses: ["poisoned"] }, { id: ids[1], statuses: ["frightened"] }];
  it("rolled, in the order of the text", async () => {
    const { monsterChoice } = await import("../module/scripts/core/monster-text.mjs");
    const r = monsterChoice("Hit: 9 damage. The target has a condition determined by rolling 1d4: on a 1, Charmed; on a 2, Frightened; on a 3, Poisoned; or on a 4, Incapacitated.", effects);
    expect(r).toEqual({ effects: "one", roll: true, order: ids });
    expect(validateEntry({ choice: r })).toEqual([]);
  });
  it("at the creature's choice", async () => {
    const { monsterChoice } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterChoice("Failure: the target has the Charmed or Frightened condition (the bard's choice).", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("Hit: 9 damage, and the target suffers one of the following effects of the captain's choice: Awe. … Poison. …", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("The fiend chooses a damage type. Failure: the target is cursed.", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("Hit: 9 damage, and the target has the monk's choice of (A) the Charmed condition or (B) the Prone condition.", effects)).toEqual({ effects: "one" });
    expect(monsterChoice("It shape-shifts to resemble a cat (Speed 30 ft.), a crow (20 ft., Fly 60 ft.), or a snake (20 ft.), or returns to its true form.", effects)).toEqual({ effects: "one" });
    // A single effect, or numbered rays: nothing to choose here.
    expect(monsterChoice("the Charmed or Frightened condition (its choice)", [effects[0]])).toBe(null);
    expect(monsterChoice("Rays (roll 1d10). 1: Weak Ray. … 2: Slow Ray. …", effects)).toBe(null);
  });
});

describe("K6: Reactions read from a monster ability's text", () => {
  it("parry: +N AC against the attack, with or without an effect in the data", async () => {
    const { monsterReactions } = await import("../module/scripts/core/monster-text.mjs");
    const text = "Trigger: The guard is hit by a melee attack roll. Response: The guard adds 4 to its AC against that attack, possibly causing it to miss.";
    expect(monsterReactions(text, { reaction: true })).toEqual({ triggers: [{ on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "use" }, { type: "penalty", formula: "4" }] }] });
    expect(monsterReactions(text, { reaction: true, acEffect: 4 })).toEqual({ triggers: [{ on: "isHit", if: { "hit.stoppableBy": 4, "activity.isMelee": true }, do: [{ type: "use" }] }] });
    expect(monsterReactions(text, { reaction: false })).toEqual({});
  });
  it("lost Reactions, action or Bonus Action", async () => {
    const { monsterReactions } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterReactions("Failure: until the end of its next turn, the target can't take Reactions and can take either an action or a Bonus Action on its turn, not both."))
      .toEqual({ noReactions: true, actionOrBonus: true });
    expect(monsterReactions("Rays. 1: Slow Ray. The target can't take Reactions. 2: Fear Ray. …")).toEqual({});
  });
});

describe("K7: recurring damage, blocked healing, absorption", () => {
  const p = "p".repeat(16), g = "g".repeat(16), a = "a".repeat(16);
  it("damage to the bearer, attached to the effect whose condition is named", async () => {
    const { monsterRecurring } = await import("../module/scripts/core/monster-text.mjs");
    const html = `<p>Failure: The target has the Poisoned condition. While Poisoned, the target takes [[/damage average activity=${a}]] damage at the start of each of its turns.</p>`;
    const r = monsterRecurring(html, [{ id: p, statuses: ["poisoned"] }, { id: g, statuses: ["grappled"] }]);
    expect(r).toEqual({ triggers: [{ on: "startOfTurn", via: "effect", fromEffect: p, do: [{ type: "damage", to: "bearer", activity: a }] }] });
    expect(validateEntry(r)).toEqual([]);
    // A swallowed creature: the Swallow building block handles it.
    expect(monsterRecurring(`A swallowed creature takes [[/damage average activity=${a}]] damage at the start of each of its turns.`)).toEqual({});
  });
  it("blocked healing and absorption", async () => {
    const { monsterRecurring } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterRecurring("While Poisoned, the target can't regain Hit Points.")).toEqual({ blocksHealing: true });
    expect(monsterRecurring("Whenever the golem is subjected to Fire damage, it regains a number of Hit Points equal to the Fire damage dealt.")).toEqual({ absorbsDamage: ["fire"] });
    expect(validateEntry({ absorbsDamage: ["fire"] })).toEqual([]);
  });
});

describe("K8: pushes and pulls read from the text", () => {
  it("failed save or hit, size gate", async () => {
    const { monsterPushes } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterPushes("Failure: 9 damage, and the target is pushed up to 30 feet straight away from the dragon.", { save: true }))
      .toEqual([{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 30, units: "ft" }] }]);
    expect(monsterPushes("Hit: 9 damage. If the target is a Huge or smaller creature, it is pushed up to 20 feet straight away from the demon.", { attack: true }))
      .toEqual([{ on: "hit", if: { "target.sizeAtMost": "huge" }, do: [{ type: "move", mode: "push", distance: 20, units: "ft" }] }]);
    expect(monsterPushes("Failure: the target is pulled up to 10 feet straight toward the knight.", { save: true })[0].do[0].mode).toBe("pull");
    expect(monsterPushes("Failure: the target is pushed or pulled up to 10 feet.", { save: true })).toEqual([]);
  });
});

describe("K9: type gate read from the text", () => {
  it("\"succeed automatically\"", async () => {
    const { monsterTypeGate } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterTypeGate("Wisdom Saving Throw: DC 12, one creature (Constructs and Undead succeed automatically). Failure: Unconscious."))
      .toEqual({ unaffectedIf: { any: [{ "target.creatureType": "construct" }, { "target.creatureType": "undead" }] } });
    expect(monsterTypeGate("If the target is a creature that isn't a Construct or an Undead, the beast gains temporary hit points.")).toBe(null);
  });
});

describe("K10: conditional Advantage read from the text", () => {
  it("wounded target, Bloodied bearer, Frightened target", async () => {
    const { monsterAdvantage } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterAdvantage("The shark has Advantage on attack rolls against any creature that doesn't have all its Hit Points."))
      .toEqual([{ on: "preAttackRoll", if: { "target.wounded": true }, do: [{ type: "advantage" }] }]);
    expect(monsterAdvantage("While Bloodied, the boar has Advantage on attack rolls.")[0].if).toEqual({ "source.hasStatus": "bloodied" });
    expect(monsterAdvantage("The knight has Advantage on attack rolls against targets that have the Frightened condition.")[0].if).toEqual({ "target.hasStatus": "frightened" });
    expect(monsterAdvantage("The wolf has Advantage on Wisdom (Perception) checks.")).toEqual([]);
  });
});

describe("K11: no half damage on a success when the text gives none", () => {
  it("\"Success\" clause with no damage, or absent", async () => {
    const { monsterSaveDamage } = await import("../module/scripts/core/monster-text.mjs");
    const acts = [{ id: "s".repeat(16), type: "save", onSave: "half" }];
    expect(monsterSaveDamage("Failure: 9 damage, and Paralyzed. Success: The target is immune to this gaze for 1 hour.", acts)).toEqual({ ["s".repeat(16)]: "none" });
    expect(monsterSaveDamage("Failure: If it has 100 Hit Points or fewer, it dies. It otherwise takes 9 damage.", acts)).toEqual({ ["s".repeat(16)]: "none" });
    expect(monsterSaveDamage("Failure: 9 damage. Success: [[/damage 4]] damage.", acts)).toBe(null);
    expect(monsterSaveDamage("Failure: 9 damage. Success: Half damage only.", acts)).toBe(null);
  });
});

describe("K11: half damage on a success when the text gives it", () => {
  it("\"Success: Half damage only\" on data set to \"none\"", async () => {
    const { monsterSaveDamage } = await import("../module/scripts/core/monster-text.mjs");
    const acts = [{ id: "n".repeat(16), type: "save", onSave: "none" }];
    expect(monsterSaveDamage("Failure: 9 damage, and engulfed. Success: Half damage only.", acts)).toEqual({ ["n".repeat(16)]: "half" });
    expect(monsterSaveDamage("Failure: 9 damage. Success: The target is pushed.", acts)).toBe(null);
  });
});

describe("§461: self-teleportation of a monster ability, within the range of its activity", () => {
  const ID = "aaaaaaaaaaaaaaaa";
  const utility = (range, extra={}) => [{ id: ID, type: "utility", range, ...extra }];
  const lookup = p => `[[lookup @range.${p} activity=${ID}]]`;

  it("\"teleports up to [range]\": the activity's range gives the distance (no written distance)", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = `<p>The [[lookup @name lowercase]] teleports up to ${lookup("value")} ${lookup("units")}. to an unoccupied space it can see.</p>`;
    const rule = monsterSelfTeleport(html, utility({ value: "40", units: "ft" }));
    expect(rule).toEqual({ activity: ID });
    expect(validateEntry({ teleport: rule })).toEqual([]);
    // "can teleport", destination then range: likewise.
    expect(monsterSelfTeleport(`<p>The beast can teleport to an unoccupied space it can see within ${lookup("value")} feet, and it bites.</p>`,
      utility({ value: "30", units: "ft" }))).toEqual({ activity: ID });
  });

  it("range \"self\": the distance the text gives", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const rule = monsterSelfTeleport("<p>The herald teleports up to 30 feet to an unoccupied space it can see and makes one Bite attack.</p>",
      utility({ units: "self" }));
    expect(rule).toEqual({ activity: ID, distance: 30, units: "ft" });
    expect(validateEntry({ teleport: rule })).toEqual([]);
    // Neither a written distance nor a readable range: nothing.
    expect(monsterSelfTeleport("<p>The herald teleports to an unoccupied space it can see.</p>", utility({ units: "self" }))).toBeNull();
  });

  it("\"along with one willing creature of its choice within 5 feet\": a passenger", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = `<p>The wolf teleports, along with one willing creature of its choice within [[lookup @target.affects.special activity=${ID}]] of it, up to ${lookup("value")} feet ${lookup("special")}.</p>`;
    const rule = monsterSelfTeleport(html, utility({ value: "30", units: "ft", special: "to an unoccupied space it can see" },
      { target: { type: "willing", count: "1", special: "within 5 feet" } }));
    expect(rule).toEqual({ activity: ID, passengers: { count: 1, within: 5, units: "ft" } });
    expect(validateEntry({ teleport: rule })).toEqual([]);
  });

  it("not read: save or attack, template, tree without distance, another creature, GM's choice", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const plain = "<p>The fiend teleports up to 60 feet to an unoccupied space it can see.</p>";
    expect(monsterSelfTeleport(plain, [{ id: ID, type: "save", range: { value: "60", units: "ft" } }])).toBeNull();
    expect(monsterSelfTeleport(plain, utility({ value: "60", units: "ft" }, { template: true }))).toBeNull();
    expect(monsterSelfTeleport(plain, [...utility({ value: "60", units: "ft" }), { id: "bbbbbbbbbbbbbbbb", type: "attack" }])).toBeNull();
    const ft = utility({ value: "60", units: "ft" });
    // §465: "within 5 feet of a creature it can see" is now read (constrained destination); a second tree without distance, not.
    expect(monsterSelfTeleport("<p>The tree spirit teleports to an unoccupied space within 5 feet of a second tree.</p>", ft)).toBeNull();
    expect(monsterSelfTeleport("<p>The demon teleports itself or a willing demon within 10 feet of itself up to 60 feet to an unoccupied space the demon can see.</p>", ft)).toBeNull();
    expect(monsterSelfTeleport("<p>The steed teleports, along with its rider, to an unoccupied space of your choice up to 60 feet away from itself.</p>", ft)).toBeNull();
    expect(monsterSelfTeleport("<p>This spell instantly transports you and up to eight willing creatures to a destination you select.</p>", ft)).toBeNull();
  });

  it("the text layer carries the teleportation (`teleport`), validated by the schema", async () => {
    const { monsterTextLayer } = await import("../module/scripts/core/monster-layer.mjs");
    const layer = monsterTextLayer({ html: "<p>The fiend teleports up to 60 feet to an unoccupied space it can see.</p>",
      activities: [{ id: ID, type: "utility", range: { value: "60", units: "ft" } }] });
    expect(layer?.teleport).toEqual({ activity: ID });
    expect(validateEntry(layer)).toEqual([]);
  });
});

describe("§462: self-teleportation with an area on the space left", () => {
  const ID = "cccccccccccccccc";
  const act = (type, template) => [{ id: ID, type, range: { value: "60", units: "ft" }, template }];
  const circle = { type: "circle", size: "10", units: "ft", count: "" };

  it("\"each creature within 10 feet of the space it left\": `area: \"left\"`, the activity's range gives the distance", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>The wraith teleports up to 60 feet to an unoccupied space it can see, and each creature within "
      + `[[lookup @target.template.size activity=${ID}]] [[lookup @target.template.units activity=${ID}]]. of the space it leaves takes 7 Cold damage.</p>`;
    for ( const type of ["damage", "save", "utility"] ) {
      const rule = monsterSelfTeleport(html, act(type, circle));
      expect(rule).toEqual({ activity: ID, area: "left" });
      expect(validateEntry({ teleport: rule })).toEqual([]);
    }
  });

  it("not read: different size, grappled creatures carried along, attack, no area clause", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const go = "The wraith teleports up to 60 feet to an unoccupied space it can see";
    expect(monsterSelfTeleport(`<p>${go}, and each creature within 10 feet of the space it left takes 7 damage.</p>`,
      act("damage", { ...circle, size: "20" }))).toBeNull();
    expect(monsterSelfTeleport("<p>The horror teleports to an unoccupied space it can see within 120 feet, taking creatures it is grappling with it. "
      + "Then each creature within 10 feet of the space it left makes a save.</p>", act("save", circle))).toBeNull();
    expect(monsterSelfTeleport(`<p>${go}, and each creature within 10 feet of the space it left takes 7 damage.</p>`, act("attack", circle))).toBeNull();
    expect(monsterSelfTeleport(`<p>${go}.</p>`, act("damage", circle))).toBeNull();
  });

  it("the schema: `area` is \"left\", \"arrival\" or nothing", () => {
    expect(validateEntry({ teleport: { activity: ID, area: "left" } })).toEqual([]);
    expect(validateEntry({ teleport: { activity: ID, area: "arrival" } })).toEqual([]);
    expect(validateEntry({ teleport: { activity: ID, area: "middle" } }).join()).toMatch(/area/);
  });

  it("the area's shape at departure: an Emanation, whatever the range", async () => {
    const { departureAreaShape } = await import("../module/scripts/core/self-area.mjs");
    expect(departureAreaShape({ type: "circle", size: "10" })).toBe("emanation");
    expect(departureAreaShape({ type: "radius", size: 10 })).toBe("emanation");
    expect(departureAreaShape({ type: "cone", size: 10 })).toBeNull();
    expect(departureAreaShape({ type: "circle", size: 10, count: 2 })).toBeNull();
    expect(departureAreaShape({ type: "circle", size: "" })).toBeNull();
  });
});

describe("§463: self-teleportation with an area at arrival", () => {
  const ID = "dddddddddddddddd";
  const act = (type, template) => [{ id: ID, type, range: { value: "60", units: "ft" }, template }];

  it("\"each creature in a 10-foot Emanation originating from it at its destination space\": `area: \"arrival\"`", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>The angel teleports up to 60 feet to an unoccupied space it can see. Dexterity Saving Throw: DC 15, each creature in a "
      + `[[lookup @target.template.size activity=${ID}]]-foot Emanation originating from the [[lookup @name lowercase]] at its destination space. Failure: 9 damage.</p>`;
    const rule = monsterSelfTeleport(html, act("save", { type: "radius", size: "10", units: "ft" }));
    expect(rule).toEqual({ activity: ID, area: "arrival" });
    expect(validateEntry({ teleport: rule })).toEqual([]);
  });

  it("\"within 5 feet of the X's destination space\", \"of its choice\": the area at the creature's choice", async () => {
    const { monsterSelfTeleport, monsterTeleportChoice } = await import("../module/scripts/core/monster-text.mjs");
    const toxic = "<p>The fiend halves the damage, and it teleports to an unoccupied space it can see within 30 feet of itself. Constitution "
      + "Saving Throw: DC 14, each creature within 5 feet of the [[lookup @name lowercase]]'s destination space.</p>";
    expect(monsterSelfTeleport(toxic, act("save", { type: "circle", size: "5", units: "ft" }))).toEqual({ activity: ID, area: "arrival" });
    expect(monsterTeleportChoice(toxic)).toBe(false);
    const sand = "<p>The mummy teleports up to 60 ft. to an unoccupied space it can see. Each creature of its choice that it can see within 5 ft. "
      + "of its destination space has the Blinded condition until the end of the mummy's next turn.</p>";
    expect(monsterSelfTeleport(sand, act("utility", { type: "circle", size: "5", units: "ft" }))).toEqual({ activity: ID, area: "arrival" });
    expect(monsterTeleportChoice(sand)).toBe(true);
  });

  it("the text layer: `teleport.area` and, \"of its choice\", `zoneAffects: \"enemy\"`", async () => {
    const { monsterTextLayer } = await import("../module/scripts/core/monster-layer.mjs");
    const layer = monsterTextLayer({ html: "<p>The mummy teleports up to 60 feet to an unoccupied space it can see. Each creature of its choice "
      + "that it can see within 5 feet of its destination space has the Blinded condition.</p>",
    activities: [{ id: ID, type: "utility", range: { value: "60", units: "ft" }, template: { type: "circle", size: "5", units: "ft" } }] });
    expect(layer?.teleport).toEqual({ activity: ID, area: "arrival" });
    expect(layer?.zoneAffects).toBe("enemy");
    expect(validateEntry(layer)).toEqual([]);
  });
});

describe("§464: self-teleportation offered after the attack", () => {
  const ATK = "eeeeeeeeeeeeeeee";
  const DMG = "ffffffffffffffff";

  it("\"Immediately after the attack hits or misses, … can teleport up to 30 feet\": `after: \"attack\"`, the text's distance", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>Melee Attack Roll: +6, reach 5 ft. Hit: 8 Slashing damage. Immediately after the attack hits or misses, the spirit can teleport "
      + "up to 30 feet to an unoccupied space it can see.</p>";
    const rule = monsterSelfTeleport(html, [{ id: ATK, type: "attack", range: { units: "self" } }]);
    expect(rule).toEqual({ activity: ATK, distance: 30, units: "ft", after: "attack" });
    expect(validateEntry({ teleport: rule })).toEqual([]);
  });

  it("\"Hit or Miss: The X can teleport up to 60 feet\", an extra damage activity (critical): likewise", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>Hit: 9 Slashing damage. Critical Hit: 4 extra damage. Hit or Miss: The knight can teleport up to 60 feet to an unoccupied space it can see.</p>";
    expect(monsterSelfTeleport(html, [{ id: ATK, type: "attack" }, { id: DMG, type: "damage" }]))
      .toEqual({ activity: ATK, distance: 60, units: "ft", after: "attack" });
  });

  it("not read: two attacks, a save alongside, a teleportation without \"after the attack\"", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>Hit: 8 damage. Hit or Miss: The knight can teleport up to 60 feet to an unoccupied space it can see.</p>";
    expect(monsterSelfTeleport(html, [{ id: ATK, type: "attack" }, { id: DMG, type: "attack" }])).toBeNull();
    expect(monsterSelfTeleport(html, [{ id: ATK, type: "attack" }, { id: DMG, type: "save" }])).toBeNull();
    expect(monsterSelfTeleport("<p>Hit: 8 damage. The knight can teleport up to 60 feet to an unoccupied space it can see.</p>",
      [{ id: ATK, type: "attack" }])).toBeNull();
  });

  it("the schema: `after` is \"attack\" or nothing", () => {
    expect(validateEntry({ teleport: { distance: 30, units: "ft", activity: ATK, after: "attack" } })).toEqual([]);
    expect(validateEntry({ teleport: { distance: 30, units: "ft", after: "save" } }).join()).toMatch(/after/);
  });
});

describe("§465: self-teleportation with a constrained destination", () => {
  const ID = "gggggggggggggggg";

  it("\"within 5 feet of a creature it can see\": near a creature, without distance (\"Waking Dream\")", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const rule = monsterSelfTeleport("<p>The horror teleports to an unoccupied space within 5 feet of a creature it can see, then makes a Spear attack.</p>",
      [{ id: ID, type: "utility", range: { units: "self" } }]);
    expect(rule).toEqual({ activity: ID, destination: { near: "creature", within: 5, units: "ft" } });
    expect(validateEntry({ teleport: rule })).toEqual([]);
  });

  it("\"uses Teleport, but its destination space must be within 10 feet of the triggering creature\": the activity's range, near the creature", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = `<p>Trigger: Another creature ends its move nearby. Response: The demon uses Teleport, but its destination space must be [[lookup @target.affects.special activity=${ID}]].</p>`;
    const rule = monsterSelfTeleport(html, [{ id: ID, type: "utility", range: { value: "120", units: "ft" },
      target: { type: "creature", count: "1", special: "within 10 feet of the triggering creature" } }]);
    expect(rule).toEqual({ activity: ID, destination: { near: "creature", within: 10, units: "ft", trigger: true } });
    expect(validateEntry({ teleport: rule })).toEqual([]);
  });

  it("\"within 5 feet of a second tree that is within 60 feet of the previous tree\": 70 ft at most, plant left to the GM", async () => {
    const { monsterSelfTeleport } = await import("../module/scripts/core/monster-text.mjs");
    const html = `<p>If within [[lookup @range.value activity=${ID}]] feet of a [[lookup @range.special activity=${ID}]], the spirit teleports to an unoccupied `
      + `space within [[lookup @range.value activity=${ID}]] feet of a second [[lookup @target.affects.special activity=${ID}]] that is within 60 feet of the previous tree.</p>`;
    const rule = monsterSelfTeleport(html, [{ id: ID, type: "utility", range: { value: "5", units: "ft", special: "Large or bigger tree" } }]);
    expect(rule).toEqual({ activity: ID, distance: 70, units: "ft", destination: { near: "plant", within: 5, units: "ft" } });
    expect(validateEntry({ teleport: rule })).toEqual([]);
  });

  it("the schema of `destination`", () => {
    expect(validateEntry({ teleport: { activity: ID, destination: { near: "creature", within: 5, units: "ft" } } })).toEqual([]);
    expect(validateEntry({ teleport: { activity: ID, destination: { near: "wall", within: 5, units: "ft" } } }).join()).toMatch(/destination/);
    expect(validateEntry({ teleport: { activity: ID, destination: { near: "creature", within: 0, units: "ft" } } }).join()).toMatch(/destination/);
  });
});

describe("§466: pushes and pulls that K8 did not read", () => {
  it("\"Success: Half damage, and the target is pushed 5 feet straight away\": on a successful save", async () => {
    const { monsterPushes } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>Dexterity Saving Throw: DC 15, each creature in the beast's destination space. Failure: 10 damage, and the target has the Prone "
      + "condition. Success: Half damage, and the target is pushed 5 feet straight away from the beast.</p>";
    const out = monsterPushes(html, { save: true });
    expect(out).toEqual([{ on: "savedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }]);
    expect(validateEntry({ triggers: out })).toEqual([]);
  });

  it("\"the X can pull the target up to 10 feet straight toward itself\": on a hit, the author chooses the distance", async () => {
    const { monsterPushes } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>Hit: 12 damage. If the target is a Huge or smaller creature, it has the Grappled condition, and the kraken can pull the target "
      + "up to 10 feet straight toward itself.</p>";
    const out = monsterPushes(html, { attack: true });
    expect(out).toEqual([{ on: "hit", if: { "target.sizeAtMost": "huge" }, do: [{ type: "move", mode: "pull", distance: 10, units: "ft", upTo: true }] }]);
  });

  it("\"pulled up to 20 feet straight toward the Sphere's center\": toward the area's center, only on a template ability", async () => {
    const { monsterPushes } = await import("../module/scripts/core/monster-text.mjs");
    const html = "<p>Dexterity Saving Throw: DC 15, each creature in a 20-foot-radius Sphere. Failure: 10 damage, and the target has the Prone "
      + "condition and is pulled up to 20 feet straight toward the Sphere's center. Success: Half damage only.</p>";
    const out = monsterPushes(html, { save: true, area: true });
    expect(out).toEqual([{ on: "failedSave", do: [{ type: "move", mode: "pull", distance: 20, units: "ft", toward: "area" }] }]);
    expect(validateEntry({ triggers: out })).toEqual([]);
    expect(monsterPushes(html, { save: true })).toEqual([]);
  });

  it("still not: \"pushed or pulled\" at choice, \"Failure or Success\", push toward a center", async () => {
    const { monsterPushes } = await import("../module/scripts/core/monster-text.mjs");
    expect(monsterPushes("<p>Failure: 9 damage, and the target is pushed or pulled up to 20 feet straight away or toward the mummy.</p>", { save: true })).toEqual([]);
    expect(monsterPushes("<p>Failure or Success: the target is pushed 10 feet straight away from the giant.</p>", { save: true })).toEqual([]);
    expect(monsterPushes("<p>Failure: the target is pushed up to 20 feet straight away from the Sphere's center.</p>", { save: true, area: true })).toEqual([]);
  });

  it("the schema: `toward` is \"area\" with a pull", () => {
    expect(validateEntry({ triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft", toward: "area" }] }] }).join()).toMatch(/toward/);
  });
});
