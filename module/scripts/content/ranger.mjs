/**
 * The Ranger of the Player's Handbook 2024 (SPEC §26), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbrgr…`), and Hunter's Mark (pack `spells`), which other classes can also cast.
 *
 * What dnd5e already does by itself: Favored Enemy (Hunter's Mark cast without a slot, uses of the item), Tireless (Temporary
 * Hit Points), Nature's Veil (Invisible effect), Roving, Feral Senses, Umbral Sight, Iron Mind, Beguiling Twist
 * (effects), Misty Wanderer and Fey Reinforcements (uses), the Primal Companion (summoning).
 */

/** "When you hit the marked creature with an attack roll". */
const marked = { "activity.isAttack": true, "target.hasEffectFrom": "hunters-mark" };

/** Roving: the three changes of the data's effect. */
const ROVING = {
  bonus: { key: "system.attributes.movement.bonus", value: 10, type: "add" },
  climb: { key: "system.attributes.movement.speeds.climb", value: "@attributes.movement.speed", type: "upgrade" },
  swim: { key: "system.attributes.movement.speeds.swim", value: "@attributes.movement.speed", type: "upgrade" }
};

export const RANGER = Object.freeze({
  // Nature's Veil (level 14) — "as a Bonus Action, you give yourself the Invisible condition until the end of your next
  // turn": the item's effect has no duration in the data and never ended.
  "natures-veil": { effectEnds: { NOSQczI2MCQ5Ha8F: "casterTurnEnd" } },
  // Relentless Hunter (level 13): "taking damage can't break your Concentration on Hunter's Mark".
  // Roving (SRD 5.2): "your Speed increases by 3 m while you are not wearing heavy armor. You also have a Climb and Swim
  // Speed equal to your Speed". The data puts all three in a single effect with no condition: the climb and swim go into
  // a separate effect, which stays, and the +3 m follows the armor.
  "roving": {
    dataFixes: [
      { effect: "dasRovingSpeeds0", create: { name: "Roving: Climb and Swim", type: "base", transfer: true, disabled: false,
        system: { changes: [ROVING.climb, ROVING.swim] } } },
      { effect: "J9RWCSmYGnP0fkn1", path: "system.changes", from: [ROVING.bonus, ROVING.climb, ROVING.swim], value: [ROVING.bonus] }
    ],
    effectWhile: { J9RWCSmYGnP0fkn1: { if: { notArmor: ["heavy"] } } }
  },
  "relentless-hunter": { keepsConcentration: ["hunters-mark"] },
  // Shadowy Dodge (Gloom Stalker 11): as a Reaction, the ranger gives Disadvantage to an attack roll that targets them
  // (§34: window before the roll); the 9 m teleportation that follows remains with the player.
  "shadowy-dodge": { triggers: [{ on: "isAttacked", do: [{ type: "use", activity: "0DMuCuULnpS5lIR5" }, { type: "disadvantage" }] }] },
  // Hunter's Mark: "1d6 extra force damage whenever you hit the target with an attack roll" —
  // 1d10 with Foe Slayer (level 20), declared on its item.
  "hunters-mark": { triggers: [{ on: "preDamageRoll", if: { ...marked, not: { "source.hasFeature": "foe-slayer" } },
    do: [{ type: "damage", formula: "1d6", damageType: "force" }] }] },
  "foe-slayer": { triggers: [{ on: "preDamageRoll", if: marked, do: [{ type: "damage", formula: "1d10", damageType: "force" }] }] },
  // Precise Hunter (level 17): "Advantage on your attack rolls against the creature affected by your Hunter's Mark".
  "precise-hunter": { triggers: [{ on: "preAttackRoll", if: { "target.hasEffectFrom": "hunters-mark" }, do: [{ type: "advantage" }] }] },

  // Hunter's Prey (Hunter 3), Colossus Slayer option — the one whose item carries the activity: "once per turn, when you
  // hit a creature with a weapon and it is missing Hit Points, 1d8 extra damage", of the weapon's type.
  // The other option (Horde Breaker, one more attack) remains with the player: nothing in the data says which is chosen.
  "hunters-prey": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isWeapon": true, "target.wounded": true },
    do: [{ type: "damage", formula: "1d8", damageType: "weapon" }] }] },

  // C12-e: Defensive Tactics (Hunter 7), Multiattack Defense option — the one whose item carries the activity: "when a creature
  // hits you with an attack roll, it has Disadvantage on all its other attack rolls against you this turn". ("Horde Nightmare",
  // the other option, remains with the player: nothing in the data says which one is chosen.)
  // Superior Hunter's Prey (Hunter 11) — "once per turn, when you deal damage to a creature marked by your Hunter's Mark, you can
  // also deal the extra damage of that spell to another creature you can see within 9 m or less of the first".
  // The d6 of the spell; the d10 with Foe Slayer.
  "superior-hunters-prey": { markSplash: { mark: "hunters-mark", formula: "1d6", damageType: "force",
    range: { value: 30, units: "ft" }, upgrades: [{ feature: "foe-slayer", formula: "1d10" }] } },
  "defensive-tactics": { hitDefense: true },
  // Superior Hunter's Defense (Hunter 15) — "when you take damage, your Reaction gives you Resistance to that
  // damage and to any other damage of the same type until the end of the current turn". Offered when an attack hits; damage
  // without an attack roll (a failed save) opens no window before being applied: there, the activity remains with the player.
  // The data carries one Resistance effect per damage type: the Reaction applies only that of the hit (step `resist`).
  "superior-hunters-defense": { triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "resist" }] }] },

  // Dread Ambusher (Gloom Stalker 3), Dreadful Strike: "you can" add 2d6 psychic damage to a weapon hit, at
  // most once per turn (2d8 with Stalker's Flurry: the subclass's scale), as many times as your Wisdom modifier per Long Rest —
  // §223 (#12): offered before the damage roll, one use of the activity spent.
  // §438: Player's Handbook 3.0.0 — two activities, "(2d6)" up to level 10, "(2d8)" after, which consume the item's uses
  // (and no longer their own): the one visible at that level counts (adapter/uses.mjs).
  "dread-ambusher": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, ask: { uses: ["DMVf7FTyTC2HCAf9", "NGiX54LWGJGvMMwL"] }, if: { "activity.isWeapon": true },
    do: [{ type: "damage", formula: "2d(6 + 2 * min(1, floor(@classes.ranger.levels / 11)))", damageType: "psychic" }] }] },
  // Dreadful Strikes (Fey Wanderer 3): a weapon hit adds 1d4 psychic damage, limited to once per turn and per target,
  // 1d6 at level 11 — the engine limits them to once per turn.
  "dreadful-strikes": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isWeapon": true },
    do: [{ type: "damage", formula: "1d(4 + 2 * min(1, floor(@classes.ranger.levels / 11)))", damageType: "psychic" }] }] }
});
