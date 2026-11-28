/**
 * The feats of the 2024 Player's Handbook (SPEC §129; full survey: prive/RELEVE_DONS.md), premium module `dnd-players-handbook`
 * 2.2.0, pack `feats`. Already elsewhere: Two-Weapon Fighting, Thrown Weapon Fighting, Interception (content/fighter.mjs),
 * Heavy Weapon Master, Telekinetic (content/triggers.mjs), War Caster (content/bursts.mjs), Boon of Dimensional Travel
 * (content/teleports.mjs).
 *
 * What dnd5e does by itself: Alert's Initiative proficiency (`initiativeAlert`), Tavern Brawler's improved attack (1d4 +
 * Str, reroll of 1s in its formula) and its proficiency with improvised weapons (`tavernBrawlerFeat`), Healer's Battle Medic
 * (activities, reroll of 1s in their formula), Lucky's points (uses of the item).
 */
export const FEATS = Object.freeze({
  // Tavern Brawler: "when you hit a creature with an Unarmed Strike as part of the Attack action on your turn,
  // you can deal the damage and push it 1.50 m. Once per turn." Offered on the hit, like a smite.
  "tavern-brawler": { hitRider: { push: { distance: 5, units: "ft" }, unarmed: true, oncePerTurn: true } },
  // Martial Savagery: "once per turn, when you hit with a weapon, roll its damage dice twice, keep either
  // one" (runtime/feats.mjs).
  "savage-attacker": { savageAttacker: true },
  // §295: the Soldier background feature (Heroes of the Borderlands) — "once per turn, on a weapon hit, its dice rolled twice":
  // the same rule as Martial Savagery.
  "soldier-feature": { savageAttacker: true },
  // Lucky: "when you roll a d20 for a D20 Test, 1 luck point for Advantage" — offered after the roll (missed attack,
  // failed save asked for by the engine, ability check): the d20 rerolled, the better kept. "When a creature rolls a
  // d20 for an attack against you, 1 point to impose Disadvantage on it" — before its roll, without costing the Reaction (`free`).
  "lucky": {
    rollBonus: { activity: "DEX2YgxfqdMse2bT", on: ["attack", "save", "check"], luck: true },
    triggers: [{ on: "isAttacked", free: true, do: [{ type: "use", activity: "jBTnM51FdGwjlBuK", target: "source" }, { type: "disadvantage" }] }]
  },
  // Alert: the Initiative swap with an ally, right after the roll (runtime/roll-bonus.mjs).
  "alert": { initiativeSwap: true },
  // Healer: "when you roll a die for the HP a spell restores… you can reroll a 1" (runtime/feats.mjs).
  "healer": { healingRerolls: true },

  // §130 — effects that the data applies without their condition (runtime/effect-while.mjs).
  // Defense: "while you are wearing Light, Medium or Heavy armor, +1 to AC".
  "defense": { effectWhile: { W0ObItz7sS8ZJ09Y: { if: { armor: ["light", "medium", "heavy"] } } } },
  // Dueling: "when you wield a melee weapon in one hand and no other weapon, +2 to damage with it".
  "dueling": { effectWhile: { VEodDUQvYPHhl0Ya: { if: { oneHanded: true } } } },
  // Heavy Armor Master: "hit by an attack while you are wearing Heavy armor" — the reduction, in Heavy armor.
  "heavy-armor-master": { effectWhile: { bADQON2o52cOL6WI: { if: { armor: ["heavy"] } } } },
  // Medium Armor Master: "in Medium armor, +3 instead of +2 from Dexterity to AC if you have 16 or more in
  // Dexterity" — that is, +1 to AC; the data key (`system.attributes.bonus`) does not exist.
  "medium-armor-master": { effectWhile: { r6D3Ach1DcRanNcj: { if: { armor: ["medium"], abilityAtLeast: { dex: 16 } },
    changes: [{ key: "system.attributes.ac.bonus", type: "add", value: "1" }] } } },
  // Skulker, Fog of War: "Advantage on Dexterity (Stealth) checks of the Hide action during a combat" —
  // in combat (the engine does not know which check is the Hide one).
  // C12-i: Sharpshooter — "if you are Hidden and miss an attack roll, the attack does not reveal you" (`sniper`, runtime/hide.mjs).
  "skulker": { effectWhile: { "6moNnOl0izLMgVNl": { if: { inCombat: true } } }, sniper: true },

  // §131 — shooting feats. Sharpshooter: "your ranged attacks with a weapon ignore half Cover and three-quarters Cover;
  // being within 1.50 m of an enemy does not impose Disadvantage on you; attacking at long range does not either".
  "sharpshooter": { rangedFeat: { kind: "weapon", cover: true, closeCombat: true, longRange: true } },
  // Crossbow Expert: no Disadvantage in melee with a crossbow; the damage modifier of the extra attack of the
  // Light property with a Light crossbow. O5a (§339): "you ignore the Loading property of crossbows" (core/turn.mjs).
  "crossbow-expert": { rangedFeat: { kind: "crossbow", closeCombat: true, offhandModifier: true, loading: true } },
  // Spell Sniper: spell attack rolls ignore half and three-quarters Cover, no Disadvantage in melee, and +18 m to
  // the range of a spell of at least 3 m that requires an attack roll.
  // §306: Improved Illusions (Illusionist 3) — "the range of your Illusion spells of at least 3 m increases by 18 m".
  "improved-illusions": { rangedFeat: { kind: "spell", spellRange: { value: 60, units: "ft", school: "ill" } } },
  "spell-sniper": { rangedFeat: { kind: "spell", cover: true, closeCombat: true, spellRange: { value: 60, units: "ft" } } },

  // §132 — blows. Crusher: "once per turn, when you hit a creature with an attack that deals bludgeoning damage, you
  // can move it 1.50 m if it is no more than one size larger than you" (offered on the hit); "a bludgeoning Critical Hit:
  // attack rolls against it have Advantage until the start of your next turn".
  "crusher": { hitRider: { push: { distance: 5, units: "ft" }, damageType: "bludgeoning", sizeAbove: 1, oncePerTurn: true },
    critMark: { damageType: "bludgeoning", side: "against" } },
  // Piercer: one die rerolled once per turn (the better kept), one more die on a piercing Critical Hit (runtime/feats.mjs).
  "piercer": { piercer: true },
  // Slasher: "once per turn… reduce its Speed by 3 m until the start of your next turn" (the Handbook's "Slashed" effect,
  // offered on the hit); "a slashing Critical Hit: Disadvantage on its attack rolls until the start of your next turn".
  "slasher": { hitRider: { effect: "JX3Krr0wbWihJ1RP", damageType: "slashing", oncePerTurn: true },
    effectEnds: { JX3Krr0wbWihJ1RP: "casterTurnStart" }, critMark: { damageType: "slashing", side: "by" } },
  // Charger: "if you move at least 3 m in a straight line toward a target right before hitting it in melee… +1d8
  // damage" — offered on the melee hit, once per turn (the player judges the charge); the 3 m push, the rule's other choice,
  // and the improved Dash are not played.
  "charger": { hitRider: { damage: "54afnEMKfBkQaByQ", melee: true, oncePerTurn: true, weaponDamage: true } },
  // Grappler: "Advantage on attack rolls against a creature you are grappling". Punch and Grab, Fast Wrestler: not played.
  "grappler": { triggers: [{ on: "preAttackRoll", if: { "target.grappledBySource": true }, do: [{ type: "advantage" }] }] },
  // Shield Master, Shield Bash: "if you hit a creature within 1.50 m with a melee weapon as part of the Attack action,
  // you can bash it with your equipped shield: Strength save or Prone" (the other choice, pushing it, is not
  // offered); once per turn. Shield Interpose: next batch.
  // §133: Shield Interpose — successful Dexterity save against damage halved: the Reaction to take none.
  "shield-master": { hitRider: { save: "VjSe0vA0dmGhNDAA", melee: true, shield: true, oncePerTurn: true }, interposeShield: true },
  // Unarmed Fighting: its two attacks (1d6 / 1d8 without weapon or shield) are those of dnd5e; "at the start of each of your
  // turns, 1d4 bludgeoning damage to a creature you are grappling" (runtime/feats.mjs).
  "unarmed-fighting": { grappleDamage: { formula: "1d4", damageType: "bludgeoning" } },

  // §133 — reactions. Defensive Duelist, Parry: "if you are holding a Finesse weapon and another creature hits you with a melee
  // attack, you can take a Reaction to add your proficiency bonus to your AC" — until the start of your
  // next turn (the Handbook's effect); the hit is re-judged.
  "defensive-duelist": {
    triggers: [{ on: "isHit", if: { "activity.isMelee": true, "target.wieldsProperty": "fin" }, do: [{ type: "use", activity: "PTNsSgiAfLVoBcXV", target: "self" }] }],
    effectEnds: { v0DJP66nvRVtxUos: "casterTurnStart" }
  },
  // Protection: "when a creature you can see attacks a target other than you within 1.50 m of you, you can interpose your
  // shield (Reaction): Disadvantage on the roll, and on all rolls against that target until the start of your next turn" — the
  // Handbook's "Protected" effect on the target; the condition "if you stay within 1.50 m" is not tracked.
  "protection": {
    triggers: [
      { on: "enemyAttacks", if: { "target.nearSelf": { distance: 5, units: "ft" }, "target.isSelf": false, "self.hasShield": true, "self.seesSource": true },
        do: [{ type: "use", activity: "8RRNln3LeSbeDlnn", target: "target" }, { type: "disadvantage" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "oSby0tJpvySxGrjY", if: { "target.hasEffect": "protection" }, do: [{ type: "disadvantage" }] }
    ],
    effectEnds: { oSby0tJpvySxGrjY: "casterTurnStart" }
  },
  // Mage Slayer: Guarded Mind — "if you fail an Intelligence, Wisdom or Charisma save, you can succeed instead"
  // (once per Short or Long Rest: the item's use); Concentration Breaker — "when you damage a concentrating creature,
  // it has Disadvantage on the save to maintain its Concentration".
  "mage-slayer": {
    rollBonus: { activity: "hPeMN85cO9DEPDCI", on: ["save"], abilities: ["int", "wis", "cha"], succeed: true },
    concentrationBreaker: true
  },
  // Sentinel: Guardian — "right after a creature within 1.50 m of you takes the Disengage action or hits a target other than you,
  // you can make an Opportunity Attack against it"; Halt — "when you hit a creature with an Opportunity Attack, its
  // Speed drops to 0 for the rest of the turn" (the Handbook's "Halted" effect, placed by runtime/feats.mjs on every Reaction
  // attack).
  // §136: Polearm Master, Reactive Strike — "while you are holding a Quarterstaff, a Spear or a Heavy weapon with Reach, you
  // can take a Reaction to make a melee attack against a creature that enters the reach you have with that weapon"
  // (runtime/reactions.mjs, with the Opportunity Attacks). Pole Strike (the Bonus Action attack with the butt): dnd5e's activity.
  "polearm-master": { reactiveStrike: true },
  "sentinel": {
    triggers: [
      { on: "allyIsHit", if: { "source.nearSelf": { distance: 5, units: "ft" } }, do: [{ type: "use", target: "source", weapon: true }] },
      { on: "enemyDisengages", if: { "source.nearSelf": { distance: 5, units: "ft" } }, do: [{ type: "use", target: "source", weapon: true }] }
    ],
    haltOnReaction: { effect: "B0d2x2p98X9D3vRh" }
  },

  // §134 — the rest. Elemental Adept: "choose a type (acid, cold, fire, lightning, thunder): your spells ignore Resistance to
  // that type, and a 1 on a damage die of a spell of that type counts as a 2" — the type, asked of the player when the feat
  // arrives, is noted on the item (`flags.dnd5e-combat.elementalType` — not the name of the rule: the item's flags that carry a
  // rule name are read as a content overlay).
  "elemental-adept": { elementalAdept: true },
  // Poisoner, Potent Poison: "a damage roll that deals poison damage ignores Resistance to poison". The doses
  // (craft, coat): dnd5e's activities.
  "poisoner": { ignoresResistance: { types: ["poison"] } },
  // Speedy: "Opportunity Attacks against you have Disadvantage" (the Speed: the Handbook's effect; Dash without Difficult
  // Terrain: not played).
  "speedy": { opportunityDisadvantage: true },
  // Athlete, Leap: "when Prone, you stand up using only 1.50 m of movement". Climb Speed: "a climb Speed
  // equal to your Speed" — the data has no effect for it: the active GM keeps it on the actor (§195, runtime/speed-grants.mjs).
  // Running jumps "after only 1.50 m" (§208).
  "athlete": { quickStand: { value: 5, units: "ft" }, grantsSpeeds: { climb: "walk" }, jump: { runUp: 5 } },
  // Observant, Quick Search: "the Search action as a Bonus Action".
  "observant": { quickSearch: true },

  // §135 — Epic Boons (level 19+). Combat Prowess: a miss becomes a hit, once until the start of your next turn.
  "boon-of-combat-prowess": { peerlessAim: true },
  // Energy Resistance: the chosen Resistances (dnd5e's "Choose Resistances" activity); Energy Redirection — "when you
  // take damage of one of the chosen types, a Reaction to direct some of it at a creature within 18 m: Dexterity save or 2d12
  // + Con": the "hurt" window when that damage is of a type one resists, against the author of the damage.
  "boon-of-energy-resistance": { triggers: [{ on: "isDamaged", if: { "damage.resisted": true }, do: [{ type: "use", activity: "gAfgFNKzMbpNdfae", target: "source" }] }] },
  // Fate, Improve Fate: 2d4 added to one's own failed d20 Test (attack, save asked for by the engine, check) — once
  // per Initiative or rest; the penalty to another creature and the bonus to an ally are left to the GM.
  // §304: "you regain this use when you roll Initiative".
  "boon-of-fate": { rollBonus: { activity: "BSFYZ98EvNknWsaE", on: ["attack", "save", "check"] }, regainOnInitiative: { item: "boon-of-fate", upTo: 1 } },
  // Fortitude: + Con to the HP regained, once per turn (the +40 to the maximum: the Handbook's effect).
  "boon-of-fortitude": { fortifiedHealing: true },
  // Irresistible Offense: bludgeoning, piercing and slashing damage ignore Resistance; Overwhelming Strike on a Critical Hit.
  "boon-of-irresistible-offense": { ignoresResistance: { types: ["bludgeoning", "piercing", "slashing"] }, overwhelmingStrike: true },
  // Recovery: Last Stand (at 0 HP: 1 HP + half the maximum, once per Long Rest); Recover Vitality: the activity.
  "boon-of-recovery": { lastStandHeal: { activity: "Ir62HahPS9t1dkkL" } },
  // Speed, Escape Artist: "the Disengage action as a Bonus Action, which also ends the Grappled condition".
  "boon-of-speed": { basicActions: { MD9GSkARB6OaFYhq: "disengage" }, cures: ["grappled"] },
  // Spell Recall: 1d4 equal to the slot level (1 to 4) — the slot is not spent.
  "boon-of-spell-recall": { spellRecall: true },
  // Night Spirit: Shadowy Form — the Resistances, only in Dim Light or Darkness (the Handbook's effect, disabled
  // in the data); Meld into Shadows — invisibility ends when one attacks, deals damage or casts a spell ("right after
  // an action, a Bonus Action or a Reaction": as close as possible).
  "boon-of-the-night-spirit": { effectWhile: { f6JofmGpxquX9bqb: { if: { light: ["dim", "dark"] } } }, breaksOn: ["attack", "damage", "spell"] }
});
