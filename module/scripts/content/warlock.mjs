/**
 * The Warlock of the 2024 Player's Handbook (SPEC §29), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbwlk…` and manifestations `phbinv…`). Already there: Pact of the Blade (§16.45), Eldritch Smite (§16.19), Thirsting Blade
 * (budget, §16.25), Dark One's Blessing (§16.25), Eldritch Blast (rays, §16.27), Hex.
 *
 * What dnd5e already does by itself: Agonizing Blast and Eldritch Spear (cantrip enchantments), Devil's Sight, Eldritch Mind,
 * Witch Sight, Fiendish Resilience, "Mind Shield" (effects), spells cast without a spell slot ("cast" activities),
 * Magical Cunning, Healing Light (healing from the dice pool).
 */

export const WARLOCK = Object.freeze({
  // Gaze of Two Minds (SRD 5.2): the warlock touches a willing creature and, until the end of their next turn, may cast spells
  // as if in that creature's space while the two are within 60 ft. The data has no effect: a marker created and linked to the
  // activity lands on the touched creature and holds the link. The activity says 60 ft; the feature is a touch (PR #234 follow-up).
  "gaze-of-two-minds": { castFromBearer: { distance: 60, units: "ft" }, effectEnds: { dasGazeTwoMinds0: "casterTurnEnd" },
    dataFixes: [{ effect: "dasGazeTwoMinds0", create: { name: "Gaze of Two Minds", type: "base", transfer: false, disabled: false,
      statuses: [], system: { changes: [] } } },
    { path: "system.activities.TqjZeWzJpT25ZX8s.effects", from: [], value: [{ _id: "dasGazeTwoMinds0" }] },
    { path: "system.activities.TqjZeWzJpT25ZX8s.range.units", from: "ft", value: "touch" }] },
  // §298 (pass C3): Pact of the Chain — "you can cast Find Familiar as a Magic action" (the data says "1 hour":
  // in combat, the summoning cost nothing).
  // One with Shadows (SRD 5.2): "while you are in an area of Dim Light or Darkness, you can cast Invisibility on yourself
  // without expending a spell slot" — the data's activity allowed it in full light.
  "one-with-shadows": { usageLimits: { uF0beZxnJDJ6LQp8: { light: ["dim", "dark"] } } },
  "pact-of-the-chain": { usageLimits: { uehA2kfgOCKRIqAs: { cost: "action" }, "5W78W2Opzhax0Jcf": { cost: "action" } } },
  // Eldritch Smite: at most once per turn, a hit with the pact weapon can cost a Pact Magic spell slot to add force damage
  // (1d8, plus 1d8 per slot level) and, optionally, knock a target of size Huge or smaller Prone —
  // offered on the hit's damage roll (§47 bis); the item's "Smite" activity stays for manual use (its trigger applies Prone,
  // content/triggers.mjs).
  "eldritch-smite": { hitRider: { damage: "CXJlzDUkMYU9w9i9", status: "prone", sizeAtMost: "huge", slot: "pact", weapon: "pact-of-the-blade", oncePerTurn: true } },
  // Repelling Blast: each ray that hits a target of size Large or smaller can push it 10 ft away in a straight line — the
  // cantrip carries the "Repulsive" enchantment; the push, optional in the rules, is always applied. C12-h: declared on
  // the invocation itself — it applies to whatever cantrip it enchants (Chill Touch, Poison Spray…).
  "repelling-blast": { triggers: [{ on: "hit", if: { "activity.enchantedBy": "repelling-blast", "target.sizeAtMost": "lg" },
    do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] },
  // Lifedrinker (level 9): at most once per turn, a hit with the pact weapon adds 1d6, necrotic, psychic or radiant at choice
  // — necrotic by default; healing by a Hit Die is left to the player.
  "lifedrinker": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.enchantedBy": "pact-of-the-blade" },
    do: [{ type: "damage", formula: "1d6", damageType: "necrotic" }] }] },
  // Radiant Soul (Celestial 6): the Charisma modifier is added, once per turn, to the radiant or fire damage of a spell of
  // the warlock.
  "radiant-soul": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "activity.isSpell": true, "activity.dealsType": ["radiant", "fire"] },
    do: [{ type: "damage", formula: "@abilities.cha.mod", damageType: "weapon" }] }] },
  // Beguiling Defenses (Archfey 10): hit by a visible attacker, the warlock can, as a Reaction, halve the damage
  // and subject the attacker to a Wisdom save — the activity targets the attacker.
  // C12-g: Searing Vengeance (Celestial 14) — Blinded creatures are so "until the end of the current turn" (the warlock's turn).
  // §438: Handbook 3.0.0 — the common Blinded of the `dnd5e.effects` compendium (`4odkdDU1wBQrCMJ1`), applied by the item's
  // activity. `currentTurnEnd`: the end of the turn on which the effect is applied — `casterTurnEnd` kept it until the end of
  // the next turn.
  "searing-vengeance": { effectEnds: { KOXCayzftTFF9Kam: "currentTurnEnd", "4odkdDU1wBQrCMJ1": "currentTurnEnd" } },
  // C12-f: "on a failure, the attacker takes psychic damage equal to the damage you took" (`retort`).
  "beguiling-defenses": { retort: { damageType: "psychic" }, triggers: [{ on: "isHit", if: { "target.seesSource": true },
    do: [{ type: "use", activity: "Y2cMdoDnGTyEqs0l", target: "source" }, { type: "halve" }] }] },
  // Dark One's Own Luck (Fiend 6): "when you make an ability check or a saving throw, add 1d10; after seeing the roll, before
  // its effects" (§38) — offered on a failed save that the engine reads; the "Luck" activity spends the use.
  // §92: Steps of the Fey — after each Misty Step, one more effect of your choice: Refreshing Step (1d10 Temporary Hit Points, on
  // yourself; "or a creature you can see within 10 ft": left to the GM) or Taunting Step (Wisdom save for creatures within 5 ft of
  // the cell left, otherwise "Taunted": Disadvantage on attacks against anyone but you, until the start of your next turn).
  // §302: Clairvoyant Combatant (Great Old One 10) — failed save: "Disadvantage on its attack rolls against you, Advantage on
  // yours against it, for the duration of the link". Duration: 10 minutes (the Awakened Mind link lasts as many minutes as the
  // level; from 10).
  "clairvoyant-combatant": {
    effectDurations: { HMegeL0quWtCaUFV: { seconds: 600 } },
    triggers: [
      { on: "preAttackRoll", via: "effect", fromEffect: "HMegeL0quWtCaUFV", if: { "target.hasEffectFrom": "clairvoyant-combatant" }, do: [{ type: "advantage" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "HMegeL0quWtCaUFV", if: { "source.hasEffectFromTarget": "clairvoyant-combatant" }, do: [{ type: "disadvantage" }] }
    ]
  },
  // §438: Handbook 3.0.0 — Misty Escape (Archfey 6) is filed here, behind level 6: the Reaction to damage
  // ("Escape", `Z2DMzP2QpvVjNVLY`, which points back to the cast), Vanishing Step (`zgz1…`) and Terrifying Step (`PPfl…`).
  // Options of a level the actor does not have are not offered (`levelHidden`). Vanishing Step: the common Invisible
  // (remote effect) ends on attack, damage, spell — per activity (`breaksOnActivity`): an item `breaksOn` would also drop
  // Taunted on the enemy who attacks.
  "steps-of-the-fey": {
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "sERUxQRn17lzEQbl", if: { "source.hasEffect": "steps-of-the-fey", not: { "source.hasEffectFromTarget": "steps-of-the-fey" } },
      do: [{ type: "disadvantage" }] },
    { on: "isDamaged", do: [{ type: "use", activity: "Z2DMzP2QpvVjNVLY" }] }],
    afterTeleport: { spells: ["misty-step"], options: [{ activity: "QUbshQXhUDQqlu2s" }, { activity: "48TdRWDqCVcC9mh4", around: "left" },
      { activity: "zgz1KLkZUycIeVF9" }, { activity: "PPflqO75qwj2WJP9", around: "left" }, { activity: "PPflqO75qwj2WJP9", around: "arrival" }] },
    saveDamage: { PPflqO75qwj2WJP9: "none" },
    breaksOnActivity: { zgz1KLkZUycIeVF9: ["attack", "damage", "spell"] }
  },
  // §92: Misty Escape — two more options: Vanishing Step (Invisible until the start of your next turn, or
  // until an attack, damage, a spell: `breaksOn`) and Terrifying Step (Wisdom save or 2d10 psychic, within 5 ft of the cell
  // left OR arrived at, at choice). Misty Step by a Reaction to damage: the data's "cast" activity.
  "misty-escape": {
    // §301: "when you take damage, Misty Step as a Reaction" — the data's "cast" activity.
    triggers: [{ on: "isDamaged", do: [{ type: "use", activity: "2ceGTpBbBclN3qF9" }] }],
    afterTeleport: { spells: ["misty-step"], options: [{ activity: "KMyLMOnvFbMuoRYa" }, { activity: "kj8zIhPbjs4UIHtc", around: "left" }, { activity: "kj8zIhPbjs4UIHtc", around: "arrival" }] },
    breaksOn: ["attack", "damage", "spell"],
    saveDamage: { kj8zIhPbjs4UIHtc: "none" }
  },
  // Psychic Spells (Great Old One 3): "when you cast a Warlock spell that deals damage, you can change its damage type
  // to psychic" — offered with the spell's types before the roll (adapter/messages.mjs). The second half (Enchantment or Illusion
  // without Verbal or Somatic components) is left to the sheet.
  "psychic-spells": { spellDamageTypes: { class: "warlock", types: ["psychic"] } },
  // Hurl Through Hell (Fiend 14) — "once per turn, when you hit a creature with an attack roll": the item's Charisma
  // save (8d10 psychic and Incapacitated on a failure) offered on the hit, its use spent.
  // "Incapacitated until the end of your next turn": the effect comes from the common effects pack (not an item effect), with no
  // duration — tracked by its condition (`status:`). Left to the player: no damage
  // against a Fiend, the target that disappears then returns, and the pact slot that restores the use (the other activity).
  "hurl-through-hell": { hitRider: { save: "vIY5Deb2vCh5POdP", oncePerTurn: true },
    effectEnds: { "status:incapacitated": "casterTurnEnd" } },
  "dark-ones-own-luck": { rollBonus: { activity: "4A1lkH3i3azHU1YQ", on: ["save", "check"] } }
});
