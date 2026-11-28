/**
 * The Monk of the Player's Handbook 2024 (SPEC §24), premium module `dnd-players-handbook` 2.2.0
 * (pack `classes`, items `phbmnk…`).
 * Vocabulary of the PHB-fr (see `translations/classes` of the PHB-fr).
 *
 * What dnd5e already does by itself: Unarmored Defense, Unarmored Movement, the Martial Arts die and the Dexterity of Unarmed
 * Strikes (the Monk's "Unarmed Strike" item, enchantment activities of Monk weapons), Evasion (§20), Extra Attack
 * (budget). The engine adds what follows (runtime/monk.mjs, runtime/turn.mjs).
 */

export const MONK = Object.freeze({
  // §301: Slow Fall (level 4) — "your Reaction when you fall: reduce the falling damage by five times your level" —
  // before it is applied (the "healing" activity gives the amount removed).
  // Superior Defense (Monk 18, SRD 5.2): "for 1 minute or until you have the Incapacitated condition".
  "superior-defense": { endsWhen: { incapacitated: "bearer" } },
  // Unarmored Movement (SRD 5.2): "while you are not wearing armor or wielding a Shield".
  "unarmored-movement": { effectWhile: { OEYjH4cLYd0VPaKm: { if: { unarmored: true } } } },
  "slow-fall": { triggers: [{ on: "falls", do: [{ type: "use", activity: "cWpSb7kUmzdpFoc4" }, { type: "reduce" }] }] },
  // §123: "touch a creature" — Hand of Healing (Warrior of Mercy), Physician's Touch (its Hand of Healing),
  // Hand of Ultimate Mercy ("touch the corpse"): "self" in the Player's Handbook data, touch in reality.
  "hand-of-healing": { ranges: { iDDZmeoYTIdWukLQ: { value: 5, units: "ft" }, ugC7uePiAZLSL55l: { value: 5, units: "ft" } },
    // §438: Player's Handbook 3.0.0 — the Hand of Healing of Physician's Touch is the activity `ugC7uePiAZLSL55l` of this item
    // (level 6, when Physician's Touch arrives); the Physician's Touch item no longer has an activity.
    cures: ["blinded", "deafened", "paralyzed", "poisoned", "stunned"], curesOn: "ugC7uePiAZLSL55l" },
  // C12-f: Physician's Touch — the Hand of Healing "also ends one of these conditions:
  // Blinded, Deafened, Paralyzed, Poisoned, Stunned".
  "physicians-touch": { ranges: { stWL2fvcxsh0HFw2: { value: 5, units: "ft" } }, cures: ["blinded", "deafened", "paralyzed", "poisoned", "stunned"], curesOn: "stWL2fvcxsh0HFw2" },
  // C12-f: "Elemental Embodiment" — "Resistance to one of these types, of your choice" (the data applies all five);
  // the lightning and thunder keys of the data (`system.traits.dr`, without `.value`) give nothing: completed.
  "elemental-epitome": {
    effectChanges: { ZgNs0IRUKwUrZGn9: [{ key: "system.traits.dr.value", type: "add", value: "lightning" }], rajbPA9Inl0nYnlP: [{ key: "system.traits.dr.value", type: "add", value: "thunder" }] }
  },
  // C12-g: "it returns to life […] and the Blinded, Deafened, Paralyzed, Poisoned and Stunned conditions end" — Dead included.
  "hand-of-ultimate-mercy": { ranges: { XtgmW9115BzcLiFr: { value: 5, units: "ft" } }, curesAll: ["dead", "blinded", "deafened", "paralyzed", "poisoned", "stunned"] },
  // C12-g: Perfect Focus (Monk 15) — "when you roll Initiative and have 3 Focus Points or fewer, you regain points up to 4"
  // ("if you don't use Uncanny Metabolism": that one is offered first, runtime/roll-bonus.mjs).
  "perfect-focus": { regainOnInitiative: { item: "monks-focus", upTo: 4 } },
  // Uncanny Metabolism (Monk 2) — "when you roll Initiative, you can regain all your expended Focus Points;
  // you then roll your Martial Arts die and regain that many Hit Points, plus your Monk level; once per Long Rest".
  // The item's activity does all three (points returned, healing, use): offered if there are points to regain.
  "uncanny-metabolism": { regainOnInitiative: { items: ["monks-focus"], activity: "RfyAj9VDmzAJkTL3" } },
  // C12-a: Disciplined Survivor (Monk 14) — "if you fail a saving throw, you can spend 1 Focus Point to reroll it,
  // and you must use the new roll" (the activity spends the point).
  "disciplined-survivor": { rollBonus: { activity: "P38SXEOizo5QaG8h", on: ["save"], reroll: {} } },
  // Martial Arts: "you can make one Unarmed Strike as a Bonus Action".
  "martial-arts": { martialArts: true },
  // Monk's Focus: Flurry of Blows (2ghJTBhilLrFn9xT) — "1 point: two Unarmed Strikes as a Bonus Action";
  // Patient Defense — free: Disengage (EFzidO6yAapw8d60); 1 point: Disengage and Dodge (7xj7b6e8tDznDSrE);
  // Step of the Wind — 1 point: Disengage and Dash; no point: Dash alone. Activity 0MuRZ0Ur95xQTKFq is the paid version
  // in Handbook 2.2.0 and the FREE version in SRD 5.2 and Handbook 3.0.0 (the point moves to `Iv2Y…` there): `{ paid, free }`
  // chooses based on what the activity spends, and the jump is doubled only for the paid form.
  // §236: Self-Restoration (level 10) — "at the end of each of your turns, you can end one of these conditions on yourself".
  "self-restoration": { endsOwnConditions: ["charmed", "frightened", "poisoned"] },
  // §236: Fleet Step (Open Hand 11) — "when you take a Bonus Action other than Step of the Wind, you can also use Step of the
  // Wind right after": free once that turn (simplification: until the end of the turn, not only "right after").
  // §295: Heightened Focus (Monk 10) — "three Unarmed Strikes with Flurry of Blows instead of two".
  "heightened-focus": { flurryStrikes: 3 },
  "fleet-step": { fleetStep: { item: "monks-focus", activity: "0MuRZ0Ur95xQTKFq" } },
  "monks-focus": {
    // §438: Player's Handbook 3.0.0 — from level 10, Flurry of Blows, Patient Defense and Step of the Wind paid with a point are
    // "Heightened" activities of this item (`r0ou…`, `KpoK…`, `R3sq…`),
    // and the Step of the Wind paid with one point (`Iv2Y…`) is distinct from the free one.
    flurry: { activity: ["2ghJTBhilLrFn9xT", "r0ou3Al6Dn3tgUC6"], strikes: 2 },
    basicActions: { EFzidO6yAapw8d60: "disengage", "7xj7b6e8tDznDSrE": ["disengage", "dodge"],
      "0MuRZ0Ur95xQTKFq": { paid: ["dash", "disengage"], free: "dash" },
      KpoKztsxm5yuJWk6: ["disengage", "dodge"], Iv2YrISquTZWEjjN: ["dash", "disengage"], R3sqnBDwAjve0FvW: ["dash", "disengage"] },
    // §208: Step of the Wind by a focus point — "and your jump distance is doubled for the turn".
    jump: { double: ["0MuRZ0Ur95xQTKFq", "Iv2YrISquTZWEjjN", "R3sqnBDwAjve0FvW"] }
  },
  // Stunning Strike (level 5): at most once per turn, on a hit with a Monk weapon or Unarmed Strike, 1 point imposes a
  // Constitution save; a target that fails it is Stunned until the start of the Monk's next turn, one that succeeds has its
  // Speed halved and the next attack against it gains Advantage, for the same duration.
  // Effects of the item: Stunned (failure), Slowed (success).
  // Quivering Palm (Open Hand 17) — "when you hit a creature with an Unarmed Strike, you can spend 4
  // Focus Points to start vibrations": offered on the hit, the item's "Lethal Vibrations" effect applied to the target;
  // "one creature at a time"; "when you end it, the target makes a Constitution saving throw" — the item's save activity
  // (10d12 force damage, half on a success), which removes the effect once resolved.
  // Ending it without damage, and instead of an attack of the Attack action, remains with the player.
  "quivering-palm": { hitRider: { effect: "GnIJc9uI54mfAQz8", unarmed: true, pays: "monks-focus", cost: 4 },
    heldEffect: { effect: "GnIJc9uI54mfAQz8", single: true, endedBy: "lBn87Q4yyJXWzLqg" } },
  "stunning-strike": {
    stunningStrike: { activity: "Xto99a8Zt46VLwaR", focus: "monks-focus" },
    savedEffects: ["cj9HhBNKtF6iOsH4"],
    effectEnds: { vofnieSTB0l8rpRg: "casterTurnStart", cj9HhBNKtF6iOsH4: "casterTurnStart" },
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "cj9HhBNKtF6iOsH4", if: { "target.hasEffect": "stunning-strike" },
      do: [{ type: "advantage" }, { type: "consume", side: "target" }] }]
  },
  // Open Hand Technique (Open Hand 3): "whenever you hit a creature with an attack of Flurry of Blows" —
  // Addle (no Opportunity Attacks until the start of its next turn), Push (Strength save or 4.50 m), Topple
  // (Dexterity save or Prone).
  "open-hand-technique": {
    openHand: { addle: "1jdSaWanuRrdkVs3", push: "XoaS0RtDCGAqrQsf", topple: "5Qgc0K3TfuonkPIG" },
    noOpportunityAttacks: true,
    effectEnds: { uQ474o5Wsv3sEAJK: "bearerTurnStart" },
    triggers: [{ on: "failedSave", if: { "activity.id": "XoaS0RtDCGAqrQsf" }, do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }]
  },
  // C12-e: Elemental Attunement (Monk of the Elements 3), Elemental Strike — "on a failed Strength saving throw, you can push or
  // pull it 3 m": push of 3 m (pulling it remains with the player).
  "elemental-attunement": { triggers: [{ on: "failedSave", if: { "activity.id": "vUWH2QBMG6gewncl" }, do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] },
  // Deflect Attacks (level 3): "when an attack roll hits you and its damage includes bludgeoning, piercing or slashing damage,
  // your Reaction reduces the total damage by 1d10 + Dexterity + Monk level" — the "Reduce" activity
  // (a heal in the data) gives the amount, which is removed from the attack's damage instead of healing.
  // §195: Acrobatic Movement (level 9) — "without armor or shield, you can move along vertical surfaces and across
  // liquids on your turn without falling during this move": "Run on the wall" (runtime/climb.mjs), without a check, without
  // a climb Speed or ceiling; the Monk who ends the turn on the wall falls. Liquids: not played.
  "acrobatic-movement": { climbsOnTurn: true },
  // C12-a: Deflect Energy (Monk 13) — "against attacks of any damage type", not only bludgeoning, piercing, slashing.
  "deflect-attacks": { triggers: [{ on: "isHit", if: { any: [{ "activity.dealsType": ["bludgeoning", "piercing", "slashing"] }, { "target.hasFeature": "deflect-energy" }] },
    do: [{ type: "use", activity: "rQwRKkuZ7WhnB7v7" }, { type: "reduce" }] }] }
});
