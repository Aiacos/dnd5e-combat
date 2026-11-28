/**
 * K12 (SPEC §333): defects in the Monster Manual 2024 data that the text alone cannot fix, by dnd5e identifier.
 * Effect ids taken from the `actors` pack of the premium module.
 */
/** "Disadvantage on attack rolls and ability checks": one source of Disadvantage per ability. */
const ATTACK_AND_CHECK_DISADVANTAGE = Object.freeze(["str", "dex", "con", "int", "wis", "cha"].flatMap(a => ["attack", "check"]
  .map(roll => ({ key: `system.abilities.${a}.${roll}.roll.mode`, value: -1, priority: null, type: "add" }))));

/**
 * A lycanthrope's curse (SRD 5.2): "If the target is a Humanoid, it is subjected to the following effect", and "Success: The
 * target is immune to this werewolf's curse for 24 hours". The mark is held in the effects gate: a targets gate would also
 * drop the hit's damage (core/monster-text.mjs, `monsterImmunity`). One mark per kind.
 */
const lycanthropeCurse = kind => ({
  effectsIf: { "target.creatureType": "humanoid", not: { "target.hasMark": `immune:${kind}-curse` } },
  triggers: [{ on: "savedSave", do: [{ type: "mark", mark: `immune:${kind}-curse`, label: "Marque.Immunite", seconds: 86400 }] }]
});

export const MONSTERS = Object.freeze({
  // "Noxious Miasma" (green dragons): the effect targets `system.armor.value`, which does nothing on a creature; −2 to AC.
  "noxious-miasma": { effectChanges: { TSWsGeApnMgxOyIF: [{ key: "system.attributes.ac.bonus", type: "add", value: "-2" }] } },
  // "Draconic Strike" (githyanki dragonmancer): the data's effect applies Prone; the text says Frightened
  // (read from the text, §334).
  "draconic-strike": { dropsEffects: ["3EaKpE9izXLyKuZ0"] },
  // §334, leftovers from K1 to K9.
  // Devour Intellect, "Grave Dust Theft": the condition lasts "until the end of the creature's next turn".
  "devour-intellect": { effectEnds: { ZaYIN5Q0TftqUIDM: "casterTurnEnd" } },
  "grave-dust-flight": { effectEnds: { j48yvRFstRgyvy4r: "casterTurnEnd" } },
  // Weakening Breath (gold dragons): Disadvantage on Strength checks and −3 to damage (the data: −1d4 to Strength checks).
  "weakening-breath": { effectChanges: { wpkp78XzdLs9q2C3: [
    { key: "system.abilities.str.bonuses.check", type: "add", value: "0", replace: true },
    { key: "system.abilities.str.check.roll.mode", type: "add", value: "-1" },
    { key: "system.abilities.str.save.roll.mode", type: "add", value: "-1" },
    ...["mwak", "rwak", "msak", "rsak"].map(k => ({ key: `system.bonuses.${k}.damage`, type: "add", value: "-3" }))
  ] } },
  // Swarm (§505): "The swarm can't regain Hit Points or gain Temporary Hit Points" — the trait, with no effect, applies to
  // the swarm.
  // (Its shared space: content/emanations.mjs, `SPACE_SHARERS`.)
  "swarm": { blocksHealing: true, blocksTempHp: true },
  // Life Drain (Will-o'-Wisp): only a creature at 0 HP.
  "consume-life": { targets: { unaffectedIf: { "target.atZero": false } } },
  // Own identifiers (content/sources.mjs, key "actor.item"): "sting" and "bite" are shared.
  // Sting (Pseudodragon): Unconscious while Poisoned (the effect cited by the activity does not exist), woken by damage.
  "mm-pseudodragon-sting": { effectStatuses: { q8stMoNP0ENULsOn: ["unconscious"] },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "q8stMoNP0ENULsOn", do: [{ type: "remove" }] }] },
  // Bite (Homunculus): Poisoned until the end of its next turn; failed by 5 or more, Unconscious, woken by damage.
  "mm-homunculus-bite": { effectEnds: { V1AmhFqcodun54W7: "casterTurnEnd" }, failMargins: { "1xPlmvipGrfrNiPY": { min: 5 } },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "1xPlmvipGrfrNiPY", do: [{ type: "remove" }] }] },
  // Sunlight Weakness (Shadow, SRD 5.2): "while in sunlight, the shadow has Disadvantage on d20 Tests" —
  // attack rolls, ability checks and saving throws. The text reading knows only "… on attack rolls".
  "sunlight-weakness": { rollDisadvantage: { on: ["check", "save"], if: { "self.inSunlight": true } },
    triggers: [{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] }] },
  // Vampire Weaknesses (Vampire, Vampire Spawn; SRD 5.2): 20 radiant damage if it starts its turn in sunlight, Disadvantage on
  // attack rolls and ability checks while it is there, 20 acid damage if it ends its turn in running water. The trait has
  // several headings: the text reading drew only the attack rolls from it. Forbiddance and Stake to the Heart remain with the GM.
  "vampire-weakness": { rollDisadvantage: { on: ["check"], if: { "self.inSunlight": true } },
    triggers: [{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] },
      { on: "startOfTurn", if: { "self.inSunlight": true },
        do: [{ type: "damage", to: "self", formula: "20", damageType: "radiant" }] },
      { on: "endOfTurn", if: { "self.inRunningWater": true },
        do: [{ type: "damage", to: "self", formula: "20", damageType: "acid" }] }] },
  // Pirate Captain's Riposte (SRD 5.2): "the pirate adds 3 to its AC against that attack". The item's "+3 AC" effect lasts a round
  // in its data: it holds for the triggering attack only. `mm-riposte` is its own identifier (sources.mjs, K6 §327), apart from the
  // Battle Master's `riposte`.
  "mm-riposte": { forOneAttack: true },
  // Sense Magic (Chuul, SRD 5.2): "the chuul senses magic within 36 m of itself; this trait otherwise works like the Detect Magic
  // spell, but is not itself magical" — permanent, no effect to carry.
  "sense-magic": { sense: { kind: "locate", range: 120, units: "ft", reveals: "aura", detects: { "target.carriesMagic": true } } },
  // Superior Magic Resistance (Rakshasa, SRD 5.2): "the rakshasa automatically succeeds on saving throws against
  // spells and other magical effects, and spell attack rolls against it automatically miss".
  "greater-magic-resistance": { saveAutoSuccessAgainst: ["magic"], spellAttacksMiss: true },
  // Freeze (Water Elemental, SRD 5.2): "if it takes cold damage, its Speed decreases by 6 m until the end of its next turn" —
  // the effect is in the data, nothing applied it. Its data duration (one turn, at the start of the turn) would make it
  // end one turn too early: `effectEnds` keeps it until the end of the bearer's next turn.
  "freeze": { onDamageTaken: { types: ["cold"], effect: "B3otZdkyUcUlgrmk" },
    effectEnds: { B3otZdkyUcUlgrmk: "bearerTurnEnd" } },
  // Aversion of Fire (Flesh Golem, SRD 5.2): "if it takes fire damage, it has Disadvantage on attack rolls and ability checks
  // until the end of its next turn" — the data's "Averse" effect is empty.
  "aversion-to-fire": { onDamageTaken: { types: ["fire"], effect: "kJYNjmfI0RpvF7CQ" },
    effectEnds: { kJYNjmfI0RpvF7CQ: "bearerTurnEnd" },
    dataFixes: [{ effect: "kJYNjmfI0RpvF7CQ", path: "system.changes", from: [], value: ATTACK_AND_CHECK_DISADVANTAGE }] },
  // Gore (Wereboar), Bite (Werebear, Wererat, Weretiger, Werewolf): the curse only targets a Humanoid (a bitten Beast used to
  // receive it), and a successful save makes the target immune for 24 hours.
  "mm-wereboar-gore": lycanthropeCurse("wereboar"),
  "mm-werebear-bite": lycanthropeCurse("werebear"),
  "mm-wererat-bite": lycanthropeCurse("wererat"),
  "mm-weretiger-bite": lycanthropeCurse("weretiger"),
  "mm-werewolf-bite": lycanthropeCurse("werewolf"),
  // Ravenloft. "Psychic Skewer" (Ancient): Exhaustion and Stunned only for a Charmed target.
  "psychic-skewer": { effectsIf: { "target.hasStatus": "charmed" } },
  // Shadow Veil (Saidra): Invisible until the start of its next turn, ends as soon as it deals damage.
  "shadow-veil": { breaksOn: ["damage"], effectEnds: { "3FJI2gtOiaXvSxrs": "bearerTurnStart" } },
  // Silver Needle (Carrionette): the curse targets only a Humanoid.
  "silver-needle": { effectsIf: { "target.creatureType": "humanoid" } },
  // Evasion (Displacer Beast): nothing on a success, half on a failure, for any saving throw that halves damage.
  "avoidance": { avoidance: true },
  // Barbed Hide (Barbed Devil, SRD 5.2): at the start of each of its turns, 1d10 piercing damage to any creature it grapples or
  // that grapples it.
  "barbed-hide": { grappleDamage: { formula: "1d10", damageType: "piercing", grapplers: true } },
  // Life Drain (Wight): the data leaves the damage untyped; necrotic.
  "mm-wight-life-drain": { untypedDamage: "necrotic" },
  // Eye Rays (Beholder, Death Tyrant; own identifier, content/sources.mjs): each ray by its effect or its
  // activity. Charm and sleep end on damage; paralysis replayed at end of turn; petrification: Restrained on the first failure,
  // Petrified on the second (the data's "Restrained" effect carries Petrified, its duplicate Petrified is discarded);
  // slowing: neither Reaction nor "action and Bonus Action" (its speed copy discarded); enervation: no healing while Poisoned;
  // durations "until the end of its next turn"; the sleep ray spares Constructs and Undead.
  "mm-beholder-eye-rays": {
    triggers: [
      { on: "isDamaged", via: "effect", fromEffect: "OZBZrDI0m8zZSCxq", do: [{ type: "remove" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "uqejMIv7S1xZmEcD", do: [{ type: "resave" }] },
      { on: "isDamaged", via: "effect", fromEffect: "TlR4l9cSFcUEbsJW", do: [{ type: "remove" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "K1dTJYj98PUwPBTZ", do: [{ type: "resave", tally: { successes: 1, failures: 1, status: "petrified" } }] }
    ],
    dropsEffects: ["l6MomayhxYuMYQR3", "DDygZ3FWo4nRabwO"],
    effectStatuses: { K1dTJYj98PUwPBTZ: { set: ["restrained"] } },
    noReactions: ["1zE4l88npB9r24MV"], actionOrBonus: ["1zE4l88npB9r24MV"], blocksHealing: ["XvZO30AwVhzcboC7"],
    effectEnds: { okGmSea9t9idzzrp: "bearerTurnEnd", XvZO30AwVhzcboC7: "bearerTurnEnd", "1zE4l88npB9r24MV": "bearerTurnEnd", "5tr2oDlFLN7khXBT": "casterTurnStart" },
    targets: { unaffectedIf: { "activity.id": "CSKrXM1Pkhlf23et", any: [{ "target.creatureType": "construct" }, { "target.creatureType": "undead" }] } }
  },
  // Ice Spear (Ice Devil): neither Bonus Action nor Reaction (read from the text), Speed −10 ft until the end of its next turn;
  // "move or act, not both" remains with the GM.
  "ice-spear": { noBonus: "273sG6C6R7qUcL2v", effectChanges: { "273sG6C6R7qUcL2v": [{ key: "system.attributes.movement.walk", type: "add", value: "-10" }] } },
  // Monster Reactions whose trigger is not enough (§334) — the effect of the response with the Reaction building blocks.
  // "Toxic Escape" (Yochlol): half of the hit's damage, then the cloud's saving throw; the teleportation remains with the GM.
  "toxic-escape": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "f6zHSW2bzTmUO9oR" }, { type: "halve" }] }] },
  // "Limited Foresight" ("Sentinel Cyclops"): Disadvantage on the attack roll against it.
  "limited-foresight": { triggers: [{ on: "isAttacked", do: [{ type: "use", activity: "oNKuSb8WamcMktfk" }, { type: "disadvantage" }] }] },
  // Ravenloft. "Parry the Blow" (Laurie Weathermay): the damage of the hit is reduced by the activity's roll.
  "deflect-blow": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "qvWn7DuBd5mmvZ1M" }, { type: "reduce" }] }] },
  // Reactive (Marilith): one Reaction on each turn of the combat.
  "reactive": { reactions: { perRound: 20 } },
  // Reactive Heads (Hydra, SRD 5.2): "for each head beyond the first, the hydra has an additional Reaction,
  // which can be used only for Opportunity Attacks" — five heads: five Reactions per round (it has no other Reaction). The count
  // follows the five heads of the stat block; dead or driven-off heads remain with the GM.
  "reactive-heads": { reactions: { perRound: 5 } },
  // Disappearance: nothing here. Several monsters carry the same item (identifier, ids) without the same rule;
  // that of the Will-o'-Wisp drops after an attack roll — read from its text (core/monster-text.mjs, `monsterBreaksOn`).
  // Ravenloft. "Esoteric Protection" (Gennifer): Stunned only for an Undead.
  "esoteric-ward": { effectsIf: { "target.creatureType": "undead" } },
  // "Warp Body" ("Lesser Star Emissary"): Stunned "until the start of its next turn" — the target's.
  "warp-body": { effectEnds: { TWb6uCeWCkVjk9eZ: "bearerTurnStart" } },
  // "Forbidden Lore" (Azalin Rex): Stunned "until the end of Azalin's next turn".
  "forbidden-knowledge": { effectEnds: { uOo6EccSwmKB7CUp: "casterTurnEnd" } },
  // "Whirling Form" ("Gibbet Speaker"): enters a creature's cell and stops there.
  "whirling-form": { sharesSpace: "enter" },
  // "Unraveling Flesh" ("Boneless"): then moves without provoking Opportunity Attacks.
  "unraveling-flesh": { noOpportunity: "afterUse" },
  // §460, Ravenloft. Energy Absorption (Jiangshi): on a failure as on a success, it regains as many HP as the necrotic damage
  // taken by the target (runtime/lifesteal.mjs). The Fly Speed gain and the Bonus Action offered remain with the GM.
  "consume-energy": { lifesteal: { damageType: "necrotic" } }
});
