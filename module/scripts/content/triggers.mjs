/**
 * Content shipped with the module (SPEC §13.4): what a dnd5e item's data do not say and
 * what the rule text says — when a Reaction opens, when a zone replays its spell, which
 * bonus damage is added. Indexed by `system.identifier` (the one of the system's compendium, kept
 * by the copies on sheets): nothing is written on the items, updating this file
 * updates everyone. An item can carry its own in `flags["dnd5e-combat"].triggers`, which
 * takes precedence. Form and vocabulary: `core/triggers.mjs`; available facts: `adapter/triggers.mjs`.
 *
 * Known steps (the full schema is in core/content.mjs, the building blocks in SPEC §16):
 *   { type: "use", target?: "source" }   reaction: offer the item's reaction activity;
 *                                        `target: "source"` = it targets whoever provoked the window
 *   { type: "replay", activity? }        lasting zone: replay the activity (or a sibling) against the creature
 *   { type: "damage", formula, damageType }   damage part added to the roll (preDamageRoll); "weapon" = the weapon's type
 *   { type: "move", mode, distance, units }   the target is pushed / pulled (moments hit, failedSave)
 *   { type: "status", status }           a native condition placed on the target (moments hit, failedSave)
 *   { type: "resave" }                   with `via: "effect"`: the effect's bearer replays the save
 *   { type: "remove" }                   with `via: "effect"`: the effect ends (isDamaged: Sleep, Hypnotic Pattern)
 *   { type: "advantage" | "disadvantage" }   a reason for Advantage / Disadvantage on the attack (preAttackRoll)
 *   { type: "ward", activity? }          with `via: "effect"`: the bearer's attacker must succeed on the save (isAttacked)
 *
 * Identifiers checked in packs/_source/spells24 of dnd5e 6.0.3 (`system.identifier`), and for the
 * non-SRD items in the PHB 2.2.0 premium module.
 */

/**
 * §285: Tasha's Hideous Laughter — "at the end of each of its turns and each time it takes damage, it repeats the save;
 * it has Advantage if the save is triggered by damage".
 */
const LAUGHTER = Object.freeze([
  { on: "endOfTurn", via: "effect", do: [{ type: "resave" }] },
  { on: "isDamaged", via: "effect", do: [{ type: "resave", advantage: true }] }
]);

export const TRIGGERS = Object.freeze({
  // Reactions (2024 rules)
  // §138: only when +5 to AC can change the hit (not on a Critical Hit, nor on a roll that exceeds AC + 5).
  "shield": [
    { on: "isHit", if: { "hit.stoppableBy": 5 }, do: [{ type: "use" }] },
    // §157: "… or when you are targeted by Magic Missile" — once: protected, there is nothing more to gain.
    { on: "isTargeted", if: { "activity.identifier": "magic-missile", not: { "target.hasEffect": "shield" } }, do: [{ type: "use", target: "self", activity: "dnd5eactivity000" }] }
  ],
  // Uncanny Dodge (PHB, Rogue 5): "when an attacker that you can see hits you with an attack roll, you
  // can use your Reaction to halve the attack's damage" (§16.11, B14).
  // §74: Parry from the Monster Manual 2024 (`mmParry000000000`, Noble, Knight…) — "hit by a melee attack roll
  // while holding a weapon: adds its Proficiency Bonus to its AC against that attack, which can make it miss". The item has
  // no effect: the bonus goes through the re-judging of the hit (`penalty`: removed from the roll, that is, added to AC, §33).
  // "Holding a weapon" is not checked.
  "parry": [{ on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "use" }, { type: "penalty", formula: "@prof" }] }],
  "uncanny-dodge": [{ on: "isHit", if: { "target.seesSource": true }, do: [{ type: "use" }, { type: "halve" }] }],
  // Warding Bond (PHB): "each time it takes damage, you take the same amount" — carried by the target's
  // "Bonded" effect, which already gives Resistance, +1 to AC and saves (§16.11).
  "warding-bond": [{ on: "isDamaged", via: "effect", do: [{ type: "damage", to: "origin" }] }],
  // "…by a creature within 60 ft that you can see": vision (P1) holds the condition.
  "hellish-rebuke": [{ on: "isDamaged", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }],

  // Lasting zones: "save on entering or ending its turn inside, once per turn"
  // §402: "a transformed creature (Wild Shape, Polymorph) that fails reverts to its true form" (`revertForm`).
  "moonbeam": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }, { on: "failedSave", do: [{ type: "revertForm" }] }],
  // §438: Handbook 3.0.0 (dnd5e 6.1 SRD) — the Emanation is placed by "Cast Spell" (utility, dnd5e behavior: Speed
  // halved); the save is the `dnd5eactivity000` activity, without a zone. The replay names it: on the old form, it is
  // the activity that placed the zone (same result as before).
  "spirit-guardians": [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dnd5eactivity000" }] }],
  "cloud-of-daggers": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],
  // §75: "Ring of arrows" (simple version, requested by the user) — the 9 m sphere that the spell's action places; a creature that
  // enters it or ends its turn there receives a projectile: the Dexterity save of the sibling activity (2d4 piercing). Four
  // projectiles (`zoneCharges`, content/spell-rules.mjs), then the spell ends. The designated creatures: allies (§366).
  "cordon-of-arrows": [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dnd5eactivity000" }] }],
  // §86: Holy Aura — "other creatures have Disadvantage on attack rolls against them" (carried by the aura's copy,
  // content/auras.mjs); "when a Fiend or an Undead hits an affected creature with a melee attack,
  // the attacker must succeed on a Constitution save or have the Blinded condition until the end of its next turn": the sibling
  // "Fiend/Undead Save" (0kylpwRauH0WgW0G, Blinded effect) played against the attacker (`save` step).
  "holy-aura": [
    { on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "holy-aura" }, do: [{ type: "disadvantage" }] },
    { on: "isHit", via: "effect", if: { "activity.isMelee": true, "source.creatureType": ["fiend", "undead"] },
      do: [{ type: "save", to: "source", activity: "0kylpwRauH0WgW0G" }] }
  ],
  // §85: Wall of Thorns — "Create Wall" / "Create Circle" place the zone (Dexterity save, 7d8 piercing, at placement);
  // "the first time a creature enters the wall on a turn, or ends its turn there": the sibling "Traversal
  // Save" (dMiM7Qec4keU3w7B, 7d8 slashing), once per turn. The ×4 movement cost is not taken over.
  "wall-of-thorns": [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dMiM7Qec4keU3w7B" }] }],
  // §80: Hunger of Hadar — "Open the Portal" (utility) places the sphere; whoever starts its turn inside takes 2d6 cold
  // ("Start of Turn Damage", G6bH5mBR3kkEYjYe), whoever ends it inside makes a Dexterity save against 2d6 acid ("End of Turn
  // Save", FGDyvqQz5JQQc5mf). One activity per moment, each once per turn.
  "hunger-of-hadar": [
    { on: "turnStart", do: [{ type: "replay", activity: "G6bH5mBR3kkEYjYe" }] },
    { on: "turnEnd", do: [{ type: "replay", activity: "FGDyvqQz5JQQc5mf" }] }
  ],
  // Spike Growth (§16.20): "2d4 piercing for every 1.50 m travelled" on entering or inside.
  "spike-growth": [{ on: "moves", do: [{ type: "replay" }] }],
  "wall-of-fire": [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],

  // Bonus damage: each attack that hits the cursed target adds 1d6 necrotic.
  "hex": [{
    on: "preDamageRoll",
    if: { "activity.isAttack": true, "target.hasEffectFrom": "hex" },
    do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }]
  }],
  // Spirit Shroud (Tasha): +1d8 to attacks that hit
  // a creature within 10 ft of the caster, as long as the caster bears the spell's effect. The type (radiant, necrotic,
  // cold) is chosen at casting: necrotic here, the sheet's item can correct it in its `triggers` flag.
  "spirit-shroud": [{
    on: "preDamageRoll",
    if: { "activity.isAttack": true, "source.hasEffect": "spirit-shroud", "target.within": { distance: 10, units: "ft" } },
    do: [{ type: "damage", formula: "1d8", damageType: "necrotic" }]
  }],
  // Great Weapon Master 2024 (PHB, feats): a hit with a Heavy weapon adds the Proficiency Bonus to the
  // damage, of the weapon's type — on its turn only: not an Opportunity Attack nor another attack made on another
  // creature's turn (`source.onOwnTurn`, like the Barbarian's bonus damage). A Bonus Action attack made on its turn gets it
  // too: the engine does not distinguish the action an attack comes from.
  "great-weapon-master": [{
    on: "preDamageRoll",
    if: { "activity.isAttack": true, "activity.isWeapon": true, "activity.hasProperty": "hvy", "source.onOwnTurn": true },
    do: [{ type: "damage", formula: "@prof", damageType: "weapon" }]
  }],

  // Zone placed by an activity, replayed by a sibling: "Create Cloud" (utility) places the sphere,
  // "Start of Turn Save" acts on whoever starts its turn inside. Two identifiers for the same sibling: `dnd5eactivity000`
  // (Player's Handbook, SRD up to dnd5e 6.0) and `pyaS54TcG7kx15V2` (dnd5e 6.1 SRD) — only the one the item carries is kept.
  "stinking-cloud": [{ on: "turnStart", do: [{ type: "replay", activity: "dnd5eactivity000" }, { type: "replay", activity: "pyaS54TcG7kx15V2" }] }],
  // Zone of Truth (SRD 5.2): "a creature that enters the spell's area for the first time on a turn or starts its turn there makes
  // a Charisma saving throw" — the item data only rolls it at the cast.
  "zone-of-truth": [{ on: ["enter", "turnStart"], do: [{ type: "replay" }] }],
  // Control Water, whirlpool (SRD 5.2): "when a creature enters the vortex for the first time on a turn or ends its turn there,
  // it makes a Strength saving throw" (2d8 Bludgeoning, half on a success).
  "control-water": [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dnd5eactivity000" }] }],
  // Sleet Storm: "enters the Cylinder for the first time on a turn or starts its turn there":
  // Dexterity save, Prone on a failure (the item has no effect: the condition is placed by the engine).
  "sleet-storm": [
    { on: ["enter", "turnStart"], do: [{ type: "replay" }] },
    // §158: "… it has the Prone condition; if it is concentrating, its Concentration is broken".
    { on: "failedSave", do: [{ type: "status", status: "prone" }, { type: "breakConcentration" }] }
  ],

  // Forced movement (SPEC §16): "the shock pushes it 3 m away from you" on a failure…
  // Bigby's Hand (items of the summoned hand, PHB 2.2.0, §16.15): "a Huge or smaller creature… the hand
  // pushes it 1.50 m plus five times your modifier"; "… or it has the Grappled condition, escape DC = your spell save DC".
  "forceful-hand": [{ on: "failedSave", if: { "target.sizeAtMost": "huge" }, do: [{ type: "move", mode: "push", distance: "5 + 5 * @flags.dnd5e.summon.mod", units: "ft", follow: true }] }],
  "grasping-hand": [{ on: "failedSave", if: { "target.sizeAtMost": "huge" }, do: [{ type: "status", status: "grappled" }] }],
  // Invoke Duplicity (§16.18): Advantage against a creature that sees the illusion, if the cleric and its double are
  // both within 1.50 m of it.
  "invoke-duplicity": [{
    on: "preAttackRoll",
    if: { "target.within": { distance: 5, units: "ft" }, "source.summonNearTarget": { item: "invoke-duplicity", distance: 5, units: "ft" } },
    do: [{ type: "advantage" }]
  }],
  // Eldritch Smite (PHB 2.2.0, invocation): the target of Huge size or smaller can also be knocked Prone —
  // a damage activity used after the hit (§16.19); optional in the rule, always applied here.
  "eldritch-smite": [{ on: "hit", if: { "target.sizeAtMost": "huge" }, do: [{ type: "status", status: "prone" }] }],
  "thunderwave": [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }],
  // Gust of Wind (PHB, `phbsplGustofWind`, §37.3): Strength save for each creature in the Line, pushed 4.50 m along
  // the Line on a failure; whoever ends its turn in the Line repeats it. The placement
  // is the activity's save; the zone lasts and replays at end of turn. Up to the player: the doubled movement toward the
  // caster, the change of direction as a Bonus Action.
  "gust-of-wind": [   // §403: the doubled movement toward the caster — `windward`, content/spell-rules.mjs
    { on: "turnEnd", do: [{ type: "replay" }] },
    { on: "failedSave", do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }
  ],
  // …Telekinetic (PHB, feats, identifier `telekinetic`; its three activities are Strength saves):
  // pushed 1.50 m…
  "telekinetic": [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }],
  // …Thorn Whip (PHB, spells): a target of Large size or smaller is pulled up to 3 m toward the caster.
  // §403: Grasping Vine, the vine's attack ("Vine Attack") — "pulled up to 9 m toward the vine" (caster's choice, `upTo`);
  // "Grappled if it is Huge or smaller" (escape DC: the engine's escape DC). "Only one creature grappled at
  // a time", releasing it without an action: up to the GM.
  "vine-attack": [{ on: "hit", do: [{ type: "move", mode: "pull", distance: 30, units: "ft", upTo: true }] },
    { on: "hit", if: { "target.sizeAtMost": "huge" }, do: [{ type: "status", status: "grappled" }] }],
  "thorn-whip": [{ on: "hit", if: { "target.sizeAtMost": "lg" }, do: [{ type: "move", mode: "pull", distance: 10, units: "ft", upTo: true }] }],

  // Repeated save (SPEC §16): "the target repeats the save at the end of each of its turns and ends
  // the spell on itself on a success". Carried by the placed effect (Paralyzed, Blindness, Deafness).
  "hold-person": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // …and on damage: "each time it takes damage, it repeats the save" (Dominate Beast, Person,
  // Monster). Tasha's Hideous Laughter: both — the end of each of its turns AND each time it takes damage
  // (§285: with Advantage on the roll triggered by damage).
  "dominate-beast": [{ on: "isDamaged", via: "effect", do: [{ type: "resave" }] }],
  "dominate-person": [{ on: "isDamaged", via: "effect", do: [{ type: "resave" }] }],
  "dominate-monster": [{ on: "isDamaged", via: "effect", do: [{ type: "resave" }] }],
  "hideous-laughter": LAUGHTER,
  // §42.2: the same spell in the Player's Handbook is called "tashas-hideous-laughter" ("hideous-laughter" is its SRD
  // name, the one of the dnd5e pack) — without this key, the rule held for no player sheet (seen on 2026-10-01).
  "tashas-hideous-laughter": LAUGHTER,
  // §42.2: the other Player's Handbook spells whose "target repeats the save at the end of each of its turns and ends the
  // spell on itself on a success" — Hold Monster, Slow, Confusion, "Sunburst", and the
  // fear of Wrathful Smite.
  "hold-monster": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "slow": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "confusion": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "sunburst": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // §295 (term-by-term pass): same repeated save, forgotten — "Nature's Wrath" (Oath of the Ancients), "Spirit Rupture"
  // (Soul Knife), Synaptic Static, Intimidating Presence (Berserker), "Enthralling Magic" (College of Lore).
  "natures-wrath": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "rend-mind": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "synaptic-static": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "intimidating-presence": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  "beguiling-magic": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // §43.1: Contagion — "the target repeats the save at the end of each of its turns until it gets three successes or three
  // failures: three successes, the spell ends; three failures, it lasts 7 days" (the effect's duration). Counter.
  "contagion": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", tally: { successes: 3, failures: 3 } }] }],
  // §43.1: Flesh to Stone — the "Turning to Stone" effect (Xt8AUh0PfYhGYBvY, Restrained): "another Constitution save at the end
  // of each of its turns; three successes, the spell ends; three failures, it is Petrified".
  "flesh-to-stone": [{ on: "endOfTurn", via: "effect", fromEffect: "Xt8AUh0PfYhGYBvY",
    do: [{ type: "resave", tally: { successes: 3, failures: 3, status: "petrified" } }] }],
  // C12-e: Prismatic Spray, Indigo (cCQh7iXKnT8PKmc1, Restrained) — "a Constitution save at the end of each of its turns; three
  // successes, the condition ends; three failures, Petrified".
  "prismatic-spray": [{ on: "endOfTurn", via: "effect", fromEffect: "cCQh7iXKnT8PKmc1",
    do: [{ type: "resave", ability: "con", tally: { successes: 3, failures: 3, status: "petrified" } }] }],
  "wrathful-smite": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Phantasmal Killer: "a Wisdom save at the end of each of its turns; on a failure, it takes the psychic damage
  // again; on a success, the spell ends" — the damage is that of the spell's activity, at the cast level.
  "phantasmal-killer": [
    { on: "endOfTurn", via: "effect", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "dnd5eactivity000" }] },
    // §157: "Disadvantage on ability checks AND attack rolls" — the effect only carries the checks.
    { on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "phantasmal-killer" }, do: [{ type: "disadvantage" }] }
  ],
  // Weird: "a Frightened target makes a Wisdom save at the end of each of its turns; on a failure, 5d10 psychic
  // damage; on a success, the spell ends on it" — the "End of Turn Save" activity (nuStSySOEkwOUnXf) carries the 5d10.
  "weird": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "nuStSySOEkwOUnXf" }] }],
  // Fear: "if the creature ends its turn in a space where it has no line of sight to you, it makes a Wisdom
  // save; on a success, the spell ends on it". (The flight — Dash action, moving away — is left to the player or the GM.)
  // §147: Dissonant Whispers — "on a failure, it must immediately use its Reaction, if it can, to move away from
  // you as far as its Speed allows": runtime/flee.mjs (`fleeOnFailedSave`, content/spells.mjs).
  "fear": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", unlessSeesOrigin: true }] }],
  // "Searing Smite": the target burns (1d6 fire) at the start of each of its turns, then tries a Constitution save that,
  // on a success, ends the spell — the "Seared" effect (A0tTvLeRetrC708K) is placed by the smite (`smite.effect`); the
  // damage first ("Damage" activity, at the cast level), the save next: two declarations, in that order.
  "searing-smite": [
    { on: "startOfTurn", via: "effect", fromEffect: "A0tTvLeRetrC708K", do: [{ type: "damage", to: "bearer", activity: "M4KS57lcf4K6fUMU" }] },
    { on: "startOfTurn", via: "effect", fromEffect: "A0tTvLeRetrC708K", do: [{ type: "resave" }] }
  ],
  // Blinding Smite: the target stays Blinded while the spell lasts, with a Constitution save at the end of each of its turns
  // to free itself — the "Blinded" effect (5FPaEGhqJ5yPP2Ln) placed by the smite, the "End of Turn Save" save.
  "blinding-smite": [{ on: "endOfTurn", via: "effect", fromEffect: "5FPaEGhqJ5yPP2Ln", do: [{ type: "resave" }] }],

  // Effect that ends on damage (SPEC §16, B8): "the spell ends for a target that takes damage". Carried by
  // the placed effect (Incapacitated; Charmed and Incapacitated). Shaking the creature (another's action) stays manual.
  "sleep": [
    { on: "isDamaged", via: "effect", do: [{ type: "remove" }] },
    // §157: "Incapacitated until the end of its next turn, when it repeats the roll; failed, Unconscious for the duration" — one
    // save, counted: succeeded, the effect drops; failed, no more rolls, the effect stays and gains Unconscious.
    { on: "endOfTurn", via: "effect", do: [{ type: "resave", tally: { successes: 1, failures: 1, status: "unconscious" } }] }
  ],
  "hypnotic-pattern": [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }],
  // §65: Suggestion — "the suggestion ends if you or your allies deal damage to the target": only that damage.
  "suggestion": [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }],
  // §295: Mass Suggestion — same end ("or until you or your allies deal damage to the target").
  "mass-suggestion": [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }],
  // §79: same end for Charm Person and Charm Monster ("until you or your allies deal damage to it") and
  // Animal Friendship ("if you or one of your allies deal damage to the target, the spell ends").
  "charm-person": [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }],
  "charm-monster": [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }],
  "animal-friendship": [{ on: "isDamaged", via: "effect", by: "originSide", do: [{ type: "remove" }] }],
  // §42.2: Calm Emotions — "this indifference ends if the target takes damage": the only effect
  // "Indifference" (cb3KFq1j9UkOUV2l); the other option (Charmed and Frightened suppressed) does not end on damage.
  "calm-emotions": [{ on: "isDamaged", via: "effect", fromEffect: "cb3KFq1j9UkOUV2l", do: [{ type: "remove" }] }],
  // Turn Undead (§16.25): "for 1 minute or until it takes damage" — the "Turned" effect
  // (iUeSbfduM7K8XrCF); Sear Undead (OftTd0Eiwnls76cX): "this damage doesn't end the turning" — §294: the effect can be
  // placed before the damage is written (seen in play on 2026-10-31), only the damage of another activity makes it drop.
  // §299: Zealous Presence (Zealot) — "Advantage on attack rolls and saving throws until the start of your next turn": the
  // data only carry the saves.
  "zealous-presence": [{ on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "zealous-presence" }, do: [{ type: "advantage" }] }],
  // §431: in the dnd5e 6.1 SRD, "Sear Undead" is a Channel Divinity activity that places the same "Turned" effect: its own
  // damage does not make it drop (`otherActivity`; Turn Undead, for its part, deals no damage).
  "channel-divinity": [{ on: "isDamaged", via: "effect", fromEffect: "iUeSbfduM7K8XrCF", by: "otherActivity", do: [{ type: "remove" }] }],
  "channel-divinity-cleric": [{ on: "isDamaged", via: "effect", fromEffect: "iUeSbfduM7K8XrCF", by: "otherActivity", do: [{ type: "remove" }] }],
  "sear-undead": [{ on: "isDamaged", via: "effect", fromEffect: "OftTd0Eiwnls76cX", by: "otherActivity", do: [{ type: "remove" }] }],

  // Retaliation (SPEC §16.9, B9): "if a creature hits you with a melee attack…".
  // Fire Shield (spells24 and PHB, same effect ids): "within 1.50 m", 2d8 — fire with the
  // warm shield (effect YbUr13GTnMrootmf, Resistance to cold), cold with the cold shield (CMEUOmIT16kjGT5J).
  "fire-shield": [
    { on: "isHit", via: "effect", fromEffect: "YbUr13GTnMrootmf", if: { "activity.isMelee": true, "target.within": { distance: 5, units: "ft" } },
      do: [{ type: "damage", to: "source", formula: "2d8", damageType: "fire" }] },
    { on: "isHit", via: "effect", fromEffect: "CMEUOmIT16kjGT5J", if: { "activity.isMelee": true, "target.within": { distance: 5, units: "ft" } },
      do: [{ type: "damage", to: "source", formula: "2d8", damageType: "cold" }] }
  ],
  // Armor of Agathys (PHB): "while you have these Temporary Hit Points", 5 cold damage per spell level — the item's damage
  // activity (dnd5eactivity200), replayed at the casting level; carried by the trace (content/traces.mjs),
  // which drops when the Temporary Hit Points are exhausted ("the spell ends early").
  "armor-of-agathys": [
    { on: "isHit", via: "effect", if: { "activity.isMelee": true, "target.hasTempHp": true }, do: [{ type: "damage", to: "source", activity: "dnd5eactivity200" }] },
    { on: "isDamaged", via: "effect", if: { "target.hasTempHp": false }, do: [{ type: "remove" }] }
  ],
  // Corrosive Form (Black Pudding, SRD 5.2): "a creature that hits the pudding with a melee attack roll
  // takes 1d8 acid damage" — the trait's damage activity (OzlTY1z1gup4C2Qq), carried by the monster's own item.
  // Without a distance condition: the "within 1.50 m" is the one of the 2014 trait, whose activity carries another id;
  // a hit from a reach weapon made at 3 m counts. The corrosion of weapons is not taken over.
  "corrosive-form": [
    { on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "damage", to: "source", activity: "OzlTY1z1gup4C2Qq" }] }
  ],
  "blindness-deafness": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Command (§16.59): the order holds for the target's next turn — the effect drops at the end of that turn.
  "command": [{ on: "endOfTurn", via: "effect", do: [{ type: "remove" }] }],
  // §19, PHB 2.2.0 spells cast by creatures of a third-party module (they hold for everyone).
  // Crown of Madness: new save at the end of each of the target's turns. (The imposed attack and the maintenance by
  // a Magic action stay with the GM.)
  "crown-of-madness": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Cause Fear (Xanathar's, shipped by a third-party creatures module): new save at the end of each of the target's turns.
  "cause-fear": [{ on: "endOfTurn", via: "effect", do: [{ type: "resave" }] }],
  // Ray of Enfeeblement: on a failure, "Enfeebled" (uaHZaHEalgWa6eoC: Disadvantage on Strength checks, -1d8 damage, in
  // its changes) and "the target repeats the save at the end of each of its turns"; on a success, "Disadvantage on its
  // next attack roll before the start of your next turn" (yril8uhQgO1dR507, placed by `savedEffects`, consumed).
  "ray-of-enfeeblement": [
    { on: "endOfTurn", via: "effect", fromEffect: "uaHZaHEalgWa6eoC", do: [{ type: "resave" }] },
    { on: "preAttackRoll", via: "effect", fromEffect: "yril8uhQgO1dR507", if: { "source.hasEffect": "ray-of-enfeeblement" },
      do: [{ type: "disadvantage" }, { type: "consume", side: "source" }] },
    // §302: Enfeebled — "Disadvantage on Strength checks… and on attack rolls using Strength" (the data only do the checks).
    { on: "preAttackRoll", via: "effect", fromEffect: "uaHZaHEalgWa6eoC", if: { "source.hasEffect": "ray-of-enfeeblement", "activity.ability": "str" },
      do: [{ type: "disadvantage" }] }
  ],
  // Melf's Acid Arrow: "2d4 acid damage at the end of its next turn" — the "Lingering Acid" effect
  // (NgglkyjzTbDh5Loa) placed on a hit, the "Persistent Acid Damage" activity (uAyE5DrJp0YpElcw, at the casting level).
  // "Miss: half the initial damage": `halfOnMiss` (content/spell-rules.mjs, §157).
  "melfs-acid-arrow": [{ on: "endOfTurn", via: "effect", fromEffect: "NgglkyjzTbDh5Loa",
    do: [{ type: "damage", to: "bearer", activity: "uAyE5DrJp0YpElcw" }, { type: "remove" }] }],
  // Vitriolic Sphere: on a failed save, another 5d4 acid at the end of the target's next turn — the
  // "Lingering Acid" effect (WHhf4PFHQBDkCAyb), the "End of Turn Damage" activity (dnd5eactivity200), like Acid Arrow.
  "vitriolic-sphere": [{ on: "endOfTurn", via: "effect", fromEffect: "WHhf4PFHQBDkCAyb",
    do: [{ type: "damage", to: "bearer", activity: "dnd5eactivity200" }, { type: "remove" }] }],
  // §80: Ensnaring Strike — "while it is Restrained, the target takes 1d6 piercing damage at the start of each of its turns":
  // the "Ensnared" effect (tFGMG3cjQTEeAhv2), the "Start of Turn Damage" activity (ZWId9mbOE9zFnP6f, at the casting level).
  "ensnaring-strike": [{ on: "startOfTurn", via: "effect", fromEffect: "tFGMG3cjQTEeAhv2",
    do: [{ type: "damage", to: "bearer", activity: "ZWId9mbOE9zFnP6f" }] }],
  // Eyebite, "Asleep" (5btX5iwwleMMzkvj): "wakes up if it takes damage". (Panicked, Sickened: up to the GM.)
  // §402: Eyebite — "a creature that succeeds can't be targeted by this spell again": marked for the spell's duration (1 minute),
  // and the mark excludes it from later castings (`targets.unaffectedIf`, content/spell-rules.mjs).
  "eyebite": [{ on: "isDamaged", via: "effect", fromEffect: "5btX5iwwleMMzkvj", do: [{ type: "remove" }] },
    { on: "savedSave", do: [{ type: "mark", mark: "eyebite-saved", label: "Marque.MauvaisOeil", seconds: 60 }] }],
  // §91: Symbol — Sleep: "regains consciousness if it takes damage"; Discord: "its attack rolls … with
  // Disadvantage" (the checks: content/spell-rules.mjs, `effectChanges`).
  "symbol": [
    { on: ["enter", "turnEnd"], do: [{ type: "replay" }] },   // §403: the 18 m sphere, for 10 minutes
    { on: "isDamaged", via: "effect", fromEffect: "A1VA7t5gB7ODNsr6", do: [{ type: "remove" }] },
    { on: "preAttackRoll", via: "effect", fromEffect: "YAwLt85sPQpUCIBI", if: { "source.hasEffect": "symbol" }, do: [{ type: "disadvantage" }] }
  ],
  // Absorb Elements (Xanathar's, shipped by a third-party creatures module): reaction to acid, cold,
  // fire, lightning or thunder damage.
  "absorb-elements": [{ on: "isDamaged", if: { "damage.hasType": ["acid", "cold", "fire", "lightning", "thunder"] }, do: [{ type: "use" }] }],

  // Conditional Advantage (SPEC §16, B6). Faerie Fire: "attack rolls against an affected creature
  // have Advantage if the attacker can see the target" — carried by the "Outlined" effect on the target.
  // Consumed mark (SPEC §16.12, B10): Guiding Bolt (PHB) — "the next attack roll against it before the end of your
  // next turn has Advantage"; the effect (Marked, native duration) drops at the first roll against the target.
  "guiding-bolt": [{
    on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "guiding-bolt" },
    do: [{ type: "advantage" }, { type: "consume", side: "target" }]
  }],
  // Vicious Mockery (PHB) — "Disadvantage on its next attack roll before the end of its next turn"; the "Mocked" effect
  // drops at the creature's first attack.
  "vicious-mockery": [{
    on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "vicious-mockery" },
    do: [{ type: "disadvantage" }, { type: "consume", side: "source" }]
  }],
  // "Defensive Veil" (§16.46) — "whenever a creature makes an attack roll against you before the spell ends, it subtracts
  // 1d4": carried by the spell's trace on the caster.
  "blade-ward": [{
    on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "blade-ward" },
    do: [{ type: "attackBonus", formula: "-1d4" }]
  }],
  // §284: Otto's Irresistible Dance, under Charmed (MpToumiJ2o3S16K7, empty in the data) — "Disadvantage on attack rolls, and
  // other creatures have Advantage on attack rolls against it"; the short dance of a successful save grants none.
  "ottos-irresistible-dance": [
    { on: "preAttackRoll", via: "effect", fromEffect: "MpToumiJ2o3S16K7",
      if: { "source.hasEffect": { item: "ottos-irresistible-dance", effect: "MpToumiJ2o3S16K7" } }, do: [{ type: "disadvantage" }] },
    { on: "preAttackRoll", via: "effect", fromEffect: "MpToumiJ2o3S16K7",
      if: { "target.hasEffect": { item: "ottos-irresistible-dance", effect: "MpToumiJ2o3S16K7" } }, do: [{ type: "advantage" }] }
  ],
  // §284: Foresight — "Advantage on D20 Tests" (the data gives it only to saves and checks, Initiative following
  // Dexterity checks) "and other creatures have Disadvantage on attack rolls against it".
  "foresight": [
    { on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "foresight" }, do: [{ type: "advantage" }] },
    { on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "foresight" }, do: [{ type: "disadvantage" }] }
  ],
  "faerie-fire": [{
    on: "preAttackRoll", via: "effect",
    if: { "target.hasEffect": "faerie-fire", "source.seesTarget": true },
    do: [{ type: "advantage" }]
  }],
  // Pack Tactics (MM 2024, 18 creatures): an ally that is not Incapacitated within 5 ft of the target.
  "pack-tactics": [{
    on: "preAttackRoll",
    if: { "source.allyNearTarget": { distance: 5, units: "ft" } },
    do: [{ type: "advantage" }]
  }],
  // Protection from Evil and Good: "creatures of those types have Disadvantage on attack rolls against the target" —
  // carried by the effect on the target. Charmed and Frightened: `wardsConditions` (§268, content/endings.mjs); possession
  // is left to the GM.
  // §288: Dispel Evil and Good — "Celestials, Elementals, Fey, Fiends, and Undead have Disadvantage on attack rolls against
  // you" (the trace placed on the caster, content/spell-rules.mjs).
  "dispel-evil-and-good": [{
    on: "preAttackRoll", via: "effect",
    if: { "target.hasEffect": "dispel-evil-and-good", "source.creatureType": ["celestial", "elemental", "fey", "fiend", "undead"] },
    do: [{ type: "disadvantage" }]
  },
  // §402: Dismissal ("Dismissal") — a creature of those types that fails is sent back to its plane of origin (`banish`: removed
  // from the scene and from combat), instead of staying targetable.
  { on: "failedSave", if: { any: ["celestial", "elemental", "fey", "fiend", "undead"].map(t => ({ "target.creatureType": t })) },
    do: [{ type: "banish" }] }],
  // Magic Circle (SRD 5.2): "the creature has Disadvantage on attack rolls against targets within the Cylinder" —
  // carried by the effect the area places on whoever stands in it. The "chosen" types here are the five in the text, all at once.
  "magic-circle": [{
    on: "preAttackRoll", via: "effect",
    if: { "target.hasEffect": "magic-circle", "source.creatureType": ["celestial", "elemental", "fey", "fiend", "undead"] },
    do: [{ type: "disadvantage" }]
  }],
  "protection-from-evil-and-good": [{
    on: "preAttackRoll", via: "effect",
    if: { "target.hasEffect": "protection-from-evil-and-good", "source.creatureType": ["aberration", "celestial", "elemental", "fey", "fiend", "undead"] },
    do: [{ type: "disadvantage" }]
  }],

  // Gates (SPEC §16, B5 bis). Counterspell: "a creature in the process of casting" — hostile, within 60 ft (Reaction range),
  // that you can see; the Reaction targets the caster, their Constitution save decides.
  "counterspell": [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", target: "source" }] }],
  // Sanctuary (PHB module): the attacker of the bearer of "Protégé" must succeed on the Wisdom save of the sister activity
  // "Sauvegarde de la cible", or loses their attack. Its end (the bearer attacks, casts a spell, hurts someone): `breaksOn`
  // (content/spells.mjs, §42.2).
  "sanctuary": [{ on: "isAttacked", via: "effect", if: { "target.hasEffect": "sanctuary" }, do: [{ type: "ward", activity: "6TdVnZPI3lxQrycI" }] }]
});
