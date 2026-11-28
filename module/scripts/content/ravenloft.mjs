/**
 * Player options from Ravenloft: The Horrors Within (SPEC §19.9), premium module `dnd-ravenloft-horrors-within` 1.0.1. Its
 * items have no dnd5e identifier: they are recognized by their compendium source (content/sources.mjs), never by their
 * name (translated by Babele). Activity and effect ids surveyed in the module's `options` pack.
 *
 * What dnd5e already does by itself: Darkvision, necrotic Resistance ("Trace de non-mort"), climb speed ("Pattes
 * d'araignée"); the domain spells; Return to Life (Spare the Dying as a Bonus Action: the item's "cast" activity);
 * Disadvantage on the cursed creature's saving throws (changes of the Path to the Grave effect).
 */

/** Touch of Death: once per turn, an extra 1d4 necrotic damage, then 1d6 from Cleric level 11. */
const pullOfDeath = (formula, atLeast11) => ({
  on: "preDamageRoll", oncePerTurn: true,
  if: {
    // A spell or an attack that hits triggers the bonus; healing is not targeted (healing also goes through this roll).
    "activity.type": ["attack", "save", "damage"],
    any: [{ "activity.isAttack": true }, { "activity.isSpell": true }],
    "target.wounded": true,
    ...(atLeast11 ? { "source.classLevelAtLeast": { class: "cleric", level: 11 } }
      : { not: { "source.classLevelAtLeast": { class: "cleric", level: 11 } } })
  },
  do: [{ type: "damage", formula, damageType: "necrotic" }]
});

/** Sentinel at Death's Door: half the damage of the attack, and no more Critical Hit. */
const sentinel = [{ type: "use" }, { type: "halve" }, { type: "uncrit" }];

export const RAVENLOFT = Object.freeze({
  /* Dark Gifts */

  // §456: Mark of the Sacrifice (Boon) — removed, it leaves the bearer with Disadvantage on Wisdom saving throws for 24 h:
  // the data's "(Removed)" effect, which its note asks to be applied by hand.
  "mark-of-sacrifice": { leavesEffects: ["UUWLKOeXgMGOPoFB"] },

  /* Reanimator Artificer */

  // C12-b: Life Shock — "touch a creature at 0 HP": the healing (self range in the data) is given on contact; then the
  // lightning bursts from the revived creature, not from the caster (the data's Emanation is centered on the caster): the
  // Dexterity save of "Lightning Emanation" applies to enemies within 3 m of it. §403: "a creature at 0 Hit Points that is
  // not dead" (like Stabilize) — on any other target, neither healing nor lightning.
  "jolt-to-life": {
    ranges: { xg84KvaBJVjFZQpV: { value: 5, units: "ft" } },
    targets: { unaffectedIf: { "activity.id": "xg84KvaBJVjFZQpV", any: [{ "target.atZero": false }, { "target.isDead": true }] } },
    burst: { activity: "hTK04U7m016p6lf6", radius: 10, units: "ft", from: ["xg84KvaBJVjFZQpV"], affects: "enemy" }
  },

  /* Dhampir */

  // Vampiric Bite: biting a living target (neither a Construct nor an Undead) lets the dhampir either recover HP equal to
  // the piercing damage, or keep that amount as a bonus for their next check or attack roll within the minute; as many
  // uses as the proficiency bonus per Long Rest (the item's uses). The item's "Strengthened Attack or Check" effect
  // (j3fPDd7Xi1nx6Xk4) carries the Constitution modifier: the engine applies it with the actual amount.
  "vampiric-bite": { empower: { damageType: "piercing", effect: "j3fPDd7Xi1nx6Xk4", excludeTypes: ["construct", "undead"] } },

  /* Domaine de la Tombe (clerc) */

  // Circle of Mortality. Touch of Death: 1d4, 1d6 at Cleric level 11 (the item's scale value is stored under its
  // identifier — so under its translated name: `@scale.circle-of-mortality` cannot be read in French). Return to Life: the
  // healing dice at maximum for a creature at 0 HP, with a spell or a Channel Divinity.
  "circle-of-mortality": { triggers: [pullOfDeath("1d4", false), pullOfDeath("1d6", true)], healsDownedMax: true },

  // Path to the Grave: the cursed creature (effect mQRlujPiGJbczcyZ) has Disadvantage on its attack rolls (the module's
  // effect says it is not automated); when the cleric or an ally the cleric can see hits the cursed creature, the cleric
  // can lift the curse to deal the cleric's Cleric level in damage to it, necrotic or radiant.
  "path-to-the-grave": {
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "mQRlujPiGJbczcyZ", if: { "source.hasEffect": "path-to-the-grave" }, do: [{ type: "disadvantage" }] }],
    discharge: { effect: "mQRlujPiGJbczcyZ", formula: "@classes.cleric.levels", damageTypes: ["necrotic", "radiant"], sees: true }
  },

  // Sentinel at Death's Door: as a Reaction, when the cleric or a Bloodied creature the cleric can see within 18 m is hit,
  // the damage of the attack is halved and a Critical Hit becomes a normal hit — uses: Wisdom modifier per Long Rest (the item's).
  "sentinel-at-deaths-door": {
    triggers: [
      { on: "isHit", do: sentinel },
      { on: "allyIsHit", if: { "target.bloodied": true, "target.nearSelf": { distance: 60, units: "ft" }, "self.seesTarget": true }, do: sentinel }
    ]
  },

  // Divine Reaper (level 17): Improved Necromancy (second target) and Soul Guardian are left to the GM (§19.9).

  /* §93: Dark Gifts — "right after making a d20 Test and rolling a 1 on the d20", the item's saving throw (DC 13 + proficiency,
     on oneself), the condition on a failure. */

  // Aberrant Anatomy, Warping Flesh: Constitution or Stunned until the end of your next turn (§289: the data ends it at the
  // start of the turn — `effectEnds`).
  "aberrant-anatomy": { onNatural1: { activity: "3gsyr1hLvSFRy6e8" }, effectEnds: { ON3Q0GCwGVqeS0WV: "bearerTurnEnd" } },
  // Echoing Soul, Intrusive Echoes: Constitution or Incapacitated (Speed halved) until the end of your next turn (§289).
  "echoing-soul": { onNatural1: { activity: "b0YlEc0swnlB4R93" }, effectEnds: { "13N8KOB67iya0ROs": "bearerTurnEnd" } },
  // Living Shadow, Doomed Will: Wisdom or Incapacitated until the start of your next turn; §289: "you must then roll a die
  // on the Shadow's Will table to determine what you do during that turn" — rolled when the effect ends
  // (the result: left to the GM).
  "living-shadow": { onNatural1: { activity: "zitGmITljzBRXTkm" }, effectEnds: { MmYLSlBTwu1FC8UR: "bearerTurnStart" },
    drawsOnEnd: { MmYLSlBTwu1FC8UR: "Compendium.dnd-ravenloft-horrors-within.tables.RollTable.rhwShadowsWillqh" } },
  // §289: Second Skin, Involuntary Change — the catalyst declared by the GM (token menu), the Charisma save at the start of
  // the next turn; on a failure: Alternate Form cast without a spell slot, or, if already spent, Stunned until the start
  // of the next turn.
  // §447: Touch of Death, Death's Contact — "the necrotic damage you deal with THIS spell ignores Resistance":
  // the Chill Touch cast by the feat's "cast" activity (its copy), not another spell nor another attack.
  "touch-of-death": { ignoresResistance: { types: ["necrotic"], from: ["UZVFEmVZMhLRl5vD"] } },
  "second-skin": { catalyst: { save: "tJwaLWFWyZvq9y0r", cast: "ZrjtFFSbJZTj8Cfm", effect: "9HmJl0qrUIVbJQUA" },
    effectEnds: { "9HmJl0qrUIVbJQUA": "bearerTurnStart" } },
  // Symbiotic Being, Symbiotic Design: Charisma or Charmed for 1d12 hours; "each time you take damage, you can
  // repeat that saving throw". What the symbiote commands: left to the GM.
  // §94: Sustained Symbiosis — "when you fail a saving throw, as a Reaction, spend a Hit Die, roll it, and add it"
  // (the activity with the largest Hit Die remaining).
  "symbiotic-being": {
    onNatural1: { activity: "R2FWsJAlulJ2Mqpa" },
    rollBonus: { activity: "hcNtMh74vYh07G7k", on: ["save"] },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "m06eYs6ZVerPzasy", do: [{ type: "resave" }] }]
  },
  // Gathered Whispers: Voice from Beyond on a natural 1 (Wisdom); §94 Unearthly Cry — "when you are hit by an attack roll,
  // as a Reaction, add your proficiency bonus to your AC against that attack" (like the MM's Parry).
  // §289: Voice from Beyond — Deafened "until the end of your next turn" (the data ends it at the start); "you have
  // Disadvantage on ability checks and attack rolls" (the data only has the checks).
  "gathered-whispers": {
    onNatural1: { activity: "sGkDp5LeqKujiO7s" },
    effectEnds: { T67RGbFPYgYo6Ics: "bearerTurnEnd" },
    triggers: [
      { on: "isHit", do: [{ type: "use", activity: "UXNlglsSGecujPQD" }, { type: "penalty", formula: "@prof" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "T67RGbFPYgYo6Ics", if: { "source.hasEffect": "gathered-whispers" }, do: [{ type: "disadvantage" }] }
    ]
  },
  // Watchers, Relentless Watchers: Wisdom or Disadvantage on d20 Tests for 1 minute, save repeated at the end of each of
  // your turns. The data's "Paranoïa" effect sets Disadvantage on checks and saving throws; attack rolls (also d20 Tests):
  // `preAttackRoll`.
  "watchers": {
    onNatural1: { activity: "udHg4QeQBIVL4UJ1" },
    triggers: [
      { on: "endOfTurn", via: "effect", fromEffect: "Off49UhYxymqhOrO", do: [{ type: "resave" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "Off49UhYxymqhOrO", if: { "source.hasEffect": "watchers" }, do: [{ type: "disadvantage" }] }
    ],
    // §94: Heightened Suspicion — "on the Search action, roll 1d4 and add it".
    searchBonus: { formula: "1d4" }
  },

  /* §94: feats (Survivor, Mist Walker, Keen Eye) and species (Reborn, Lupin). */

  // Survivor, Pull Yourself Together: a failed saving throw to avoid or end Charmed or Frightened — as a Reaction, +
  // proficiency bonus (once per Long Rest: the activity's uses). §120: Hypervigilance — "when you roll Initiative, you can
  // reroll the d20 if it is 9 or lower; you keep the new roll": the question is put to the player.
  "survivor-ravenloft": {
    rollBonus: { activity: "9wAIIWcBr8lwp7Rm", on: ["save"], statuses: ["charmed", "frightened"] },
    rerollInitiative: { atMost: 9 }
  },
  // Mist Walker, Mist Walk: "when you take damage, as a Reaction, teleport up to 4.50 m" (the teleportation
  // targeting opens after the reaction). On a failed save against Grappled or Restrained: left to the GM.
  "mist-walker": {
    triggers: [{ on: "isDamaged", do: [{ type: "use", activity: "nJFQptHB2QvgTiCA" }] }],
    teleport: { distance: 15, units: "ft", activity: "nJFQptHB2QvgTiCA" }
  },
  // Keen Eye: Advantage on checks of the Search action (the Study action: left to the GM).
  "sharp-eye-ravenloft": { searchBonus: { advantage: true } },
  // Reborn, Knowledge from a Past Life: "when you fail an ability check, add 1d6" — offered as soon as the check is
  // rolled (the DC is not known to the engine).
  "knowledge-from-a-past-life": { rollBonus: { activity: "3JqLx79wBu1mq9WP", on: ["check"] } },
  // Lupin, Howl: "each creature of your choice within 4.50 m" (the data's area; allies spared) — Wisdom or Disadvantage
  // on attack rolls and saving throws until the start of your next turn (the data's effect only does the saving throws).
  "lupin-howl": {
    zoneAffects: "enemy",
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "TCo6F7H9E70wJeB5", if: { "source.hasEffect": "lupin-howl" }, do: [{ type: "disadvantage" }] }]
  },
  // Lupin, Ferocious Leap: an unarmed strike that hits ALSO allows the Shove (once per turn) — its saving throw (Strength or
  // Dexterity), Prone on a failure; pushing 1.50 m instead: left to the GM.
  "feral-pounce": { hitRider: { save: "rW3uaSjC7gS5YQnM", item: "feral-pounce", oncePerTurn: true } },

  /* §95 : sous-classes. */

  // Undead Patron, Form of Dread — Terrifying Avatar: "once per turn, when you hit a creature with an attack roll,
  // you can force it to make a Wisdom save; Frightened until the end of your next turn" — under the Form (its effect on you).
  // The Temporary Hit Points, the Immunity to Frightened: the data's activity and effect.
  // §299: the form "ends if you have the Incapacitated condition".
  // §441: Frightened "until the end of your next turn" (the data's 3K2z… effect ends at the start of anyone's next turn).
  // Superior Dread (level 14: Resistance to bludgeoning/piercing/slashing, hover): the data has the effect (1oBM…) but
  // the "Assume Avatar" activity does not pick it at any level (≤ 9: base form, ≥ 10: with Necrotic Husk) — tier ≥ 14 added.
  "form-of-dread": { hitRider: { save: "Oqz9j7aHHPnRKdD9", oncePerTurn: true, whileActive: true }, endsWhen: { incapacitated: "bearer" },
    effectEnds: { "3K2zIjA7tFdREiJA": "casterTurnEnd" },
    dataFixes: [{ path: "system.activities.sjAc47PXRIIRKS0u.effects",
      from: [{ _id: "4vZQGHnDrz11Fy0j", level: { min: null, max: 9 } }, { _id: "TH1kqbmgrvkMohdQ", level: { min: 10, max: null } }],
      value: [{ _id: "4vZQGHnDrz11Fy0j", level: { min: null, max: 9 } }, { _id: "TH1kqbmgrvkMohdQ", level: { min: 10, max: 13 } },
        { _id: "1oBMDR1fQh6rCruX", level: { min: 14, max: null } }] }] },
  // Necrotic Husk, Unholy Resurrection: at 0 HP without dying, "each creature of your choice in a 9 m Emanation makes a
  // Constitution save (2d10 + Charisma necrotic, half on a success); your HP become 2 × your Warlock level; 1 level
  // of Exhaustion" — the data's activity, whose consumptions set the HP and the Exhaustion.
  // §441: Necrotic Resilience — necrotic Resistance outside the Form (the data only gives Immunity, under the Form).
  "necrotic-husk": { atZero: { activity: "TC2Yiws12Xp7kSbm" }, zoneAffects: "enemy", grantsResistances: ["necrotic"] },
  // §447: Marked by the Grave, Arcane Necrosis — "the necrotic damage of your attacks, of your Warlock spells and features
  // ignores Resistance to necrotic" (features: the Necrotic Husk, the only one that deals any); "once per turn, a spell that deals
  // damage can change it to necrotic" (offered before the roll; the once-per-turn limit: left to the player). Magic does not put it
  // to sleep: Sleep (content/targets.mjs). Dreadful Necrosis (one extra die under the Form of Dread): left to the GM.
  "grave-touched": {
    ignoresResistance: { types: ["necrotic"], if: { any: [{ "activity.isAttack": true }, { "activity.classSpell": "warlock" }, { "activity.identifier": "necrotic-husk" }] } },
    spellDamageTypes: { types: ["necrotic"] }
  },
  // Ghost, Wails from the Grave: after a Sneak Attack on your turn, a second creature within 9 m of the first.
  "wails-from-the-grave": { afterSneak: { activity: "UxZzzGtEv93Yfs6H", radius: 30, units: "ft" } },
  // §447: Friend of Death, Allure of Death — "when you roll Initiative, you gain a soul trinket if you have none" (the
  // "initiative" recovery of the data is a special type that dnd5e does not play by itself). Death's Lament (both targets):
  // left to the player.
  "deaths-friend": { regainOnInitiative: { item: "soul-trinkets", upTo: 1 } },
  // Ghost, Ghost Walk — Misty Form: "attack rolls against you have Disadvantage" (the flight: the data's effect;
  // passing through creatures and objects: left to the GM).
  "ghost-walk": { triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "9NkA3EngQDOc2ONY", if: { "target.hasEffect": "ghost-walk" }, do: [{ type: "disadvantage" }] }] },
  // Shadow Sorcery, Shadow Power — Strength of the Grave: at 0 HP without dying, Charisma save (DC 5 + the damage taken);
  // on a success, HP = Charisma + Sorcerer level (the data's "Heal on Success" healing, on you). Once per Long Rest.
  // §447: Eyes of Darkness — "you see normally through the Darkness of a spell you cast" (`seesThroughOwnDarkness`).
  "power-of-shadow": { atZero: { activity: "EmL9RVBiEFBPk2Cf", save: { ability: "cha", dc: "5 + @damage" } }, seesThroughOwnDarkness: true },
  // §447: Umbral Form — the "Innate Sorcery in Umbral Form" activity spends Innate Sorcery and the form, without applying
  // the effect the item carries (DC +1, Resistances, `transformed`, 1 minute): the data attaches it to the item.
  // Advantage on the attacks of Sorcerer spells from Innate Sorcery, as long as that effect is worn (the `innate-sorcery`
  // rule only sees its own effect).
  // Incorporeal Movement (passing through creatures and objects, 1d10 force damage if you end your turn in them): left to the GM.
  "umbral-form": {
    dataFixes: [{ path: "system.activities.kkoILNOHSzVHTCZX.effects", from: [], value: [{ _id: "vAfLEL8A1fNW5JWb", level: { min: null, max: null } }] }],
    triggers: [{ on: "preAttackRoll", if: { "source.hasEffect": "umbral-form", "activity.classSpell": "sorcerer" }, do: [{ type: "advantage" }] }]
  },
  // Shadow Walk: 36 m teleportation, "in Dim Light or Darkness, to such a space" (§367: `maxLight`).
  "shadow-walk": { teleport: { distance: 120, units: "ft", activity: "XZKq03VYLlOcRzj2", maxLight: "dim" } },
  // Hollow Warden, Savage Wrath — Disturbing Aura: "at the start of each of your subsequent turns, each creature of your choice in
  // a 3 m Emanation makes a Wisdom save or is Frightened" — while you are transformed (the data's effect).
  // §447: the aura also acts "when you transform" (`atStart`); the form ends if the Ranger is Incapacitated (the enchantment that
  // the feature places on itself, `endsWhen`); Ranger Reprisal — "right after a creature you can see within 1.50 m damages you, or
  // damages one of your allies, an Opportunity Attack against it" (for an ally: when it hits them, the window before the damage).
  "wrath-of-the-wild": {
    emanation: { on: "ownTurnStart", affects: "enemy", activity: "Lz2jHFS3S8PB3Yyy", radius: 10, units: "ft", whileActive: true, atStart: true },
    endsWhen: { incapacitated: "bearer" },
    // §447: Rot and Violence (level 11), Menacing Aura — the creature that fails its save against the Disturbing Aura "can neither
    // regain HP nor take Reactions until the start of your next turn": the effect the data applies from level 11
    // (FU4Sq…, "Frightened (Menacing Aura)", without changes). Strangling Roots (a second weapon mastery): left to the player.
    noReactions: ["FU4SqQwhN1i0chUR"], blocksHealing: ["FU4SqQwhN1i0chUR"],
    triggers: [
      { on: "isDamaged", if: { "target.hasEffect": "wrath-of-the-wild", "target.within": { distance: 5, units: "ft" }, "target.seesSource": true },
        do: [{ type: "use", target: "source", weapon: true }] },
      { on: "allyIsHit", if: { "self.hasEffect": "wrath-of-the-wild", "source.nearSelf": { distance: 5, units: "ft" }, "self.seesSource": true },
        do: [{ type: "use", target: "source", weapon: true }] }
    ]
  },
  // Ancestral Power — Menacing Strikes: against a Frightened creature, + Wisdom modifier to damage (of the weapon's type);
  // Lingering Wrath: at 0 HP without dying under Savage Wrath, HP = 2 × Ranger level.
  /* §96: College of Spirits — the Spirits from Beyond ("Unleash": a creature visible within 9 m). Incendiary, Beloved, Sharpshooter,
     Trickster, Traveler: the data is enough. */

  // Avenging Spirit: "until the end of your next turn, any creature that hits the target with a melee attack takes
  // force damage equal to an Inspiration die" — the activity's damage part does not hurt the target (the protected ally): it is
  // that of the retaliation (`damage` toward the source, the "Avenger Spirit" effect carried by the target).
  "avenger-spirit": {
    noDamage: ["bUvbdWWaJyHezUM8"],
    triggers: [{ on: "isHit", via: "effect", fromEffect: "e96hqFRAlTYwkiMD", if: { "activity.isMelee": true }, do: [{ type: "damage", to: "source", activity: "bUvbdWWaJyHezUM8" }] }]
  },
  // Brute Spirit: "each creature of your choice in a 9 m Emanation from the target" — Strength, 3 dice and Prone on a failure.
  "brute-spirit": { zoneAffects: "enemy", triggers: [{ on: "failedSave", do: [{ type: "status", status: "prone" }] }] },
  // Cowardly Spirit: Wisdom or Frightened until the start of your next turn, Speed halved, an action OR a Bonus Action
  // — the data's effect carries the Speed, not the condition.
  "coward-spirit": { zoneAffects: "enemy", effectStatuses: { HKUw9TEea19fIOjW: ["frightened"] }, actionOrBonus: true },
  // Fortune-Teller Spirit: "Advantage on d20 Tests" — the data's effect does the checks and saving throws, not the attacks.
  "fortune-teller-spirit": { triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "WLZAxHnr32KEwxxu", if: { "source.hasEffect": "fortune-teller-spirit" }, do: [{ type: "advantage" }] }] },
  // Priest Spirit: the healing, and "one of those conditions of your choice ends".
  "priest-spirit": { cures: ["blinded", "charmed", "deafened", "paralyzed", "poisoned", "stunned"] },
  // Shadow Spirit: Invisible "until the end of its next turn, or until it attacks, deals damage or casts a
  // spell". §367: the 1.50 m Emanation when the invisibility ends ("Emanate and End", `endActivity`).
  "shade-spirit": { breaksOn: ["attack", "damage", "spell"],
    endActivity: { fzN2X69eyByhtaYu: { activity: "abooAkpLL09oe1T8", radius: 5, units: "ft" } } },
  // Empowered Channeling, Power from Beyond: "once per turn, when you cast a Bard spell with a slot that
  // deals damage, roll 1d6 and add it" (to healing: left to the GM). Spiritual Manifestation (Cover from Spirit Guardians):
  // left to the GM.
  "empowered-channeling": {
    triggers: [{ on: "preDamageRoll", oncePerTurn: true,
      if: { "activity.classSpell": "bard", not: { "activity.cantripOf": "bard" }, "activity.type": ["attack", "save", "damage"] },
      do: [{ type: "damage", formula: "1d6", damageType: "weapon" }] }]
  },

  // K3 (§324): Mist Wanderer's Dire Curse — Blinded AND Deafened; the data's "Cursed" effect only carries Deafened.
  "death-curse": { effectStatuses: { rY64ISTXCtioTGxl: ["blinded"] } },
  // §441: Timeless — Immunity to the Exhaustion condition (absent from the data).
  "ancient-might": {
    grantsConditionImmunities: ["exhaustion"],
    atZero: { activity: "pVReuhjfvDIn7X5B", whileEffect: "wrath-of-the-wild" },
    triggers: [{ on: "preDamageRoll", if: { "activity.isAttack": true, "target.hasStatus": "frightened" }, do: [{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }] }]
  }
});
