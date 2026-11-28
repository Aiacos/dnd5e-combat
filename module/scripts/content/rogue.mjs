/**
 * The Rogue from the 2024 Player's Handbook (SPEC §20), premium module `dnd-players-handbook` 2.2.0 (`classes` pack, items
 * `phbrge…`). Activity and effect ids surveyed in that pack; dnd5e identifiers kept by the copies on the sheets.
 *
 * What dnd5e already does by itself: Expertise, Reliable Talent (effect: 10 minimum on proficient skill checks), Slippery
 * Mind (saving throw proficiencies), weapon Mastery; Assassinate: Advantage on Initiative (the item's effect).
 */

/** Cunning Strike (level 5): Poison (poisoner's kit), Trip (Large or smaller), Withdraw — 1d6 each. */
const CUNNING_STRIKES = Object.freeze({
  poison: { cost: 1, activity: "n64fvJMT9fPUy7DH", requires: "poisoners-kit" },
  trip: { cost: 1, activity: "dWcCw1vTWRMx4YzD", sizeAtMost: "lg" },
  withdraw: { cost: 1, withdraw: true }
});

/** Devious Strikes (level 14): Daze (2d6), Knock Out (6d6), Obscure (3d6). */
const DEVIOUS_STRIKES = Object.freeze({
  daze: { cost: 2, activity: "4TnBjQTJzt9UjUos" },
  knockOut: { cost: 6, activity: "3eq7lcmpkJJBU2KO" },
  obscure: { cost: 3, activity: "ki4lIPVGNA0HjEzH" }
});

export const ROGUE = Object.freeze({
  // §299: Psychic Veil (Soulknife 13) — the invisibility "ends immediately after you deal damage to a creature or
  // force a creature to make a saving throw" (an attack roll counts: it deals the damage of the hit).
  "psychic-veil": { breaksOn: ["attack", "damage", "forcesSave"] },
  // Sneak Attack: the item's dice (`@scale.rogue.sneak-attack`), once per turn (core/sneak.mjs).
  "sneak-attack": { sneakAttack: true },
  // §208: Second-Story Work (Thief 3), Jumper — "the jump distance with Dexterity instead of Strength".
  "second-story-work": { jump: { useDex: true } },

  // Cunning Action (level 2): "on your turn, you can take one of the following actions as a Bonus Action: Dash,
  // Disengage, or Hide". The item's three activities already cost the Bonus Action; the engine applies the turn's condition (Dash,
  // Disengage) or makes the Stealth check for Hide (runtime/hide.mjs) — the item's "Hiding" effect is not applied.
  "cunning-action": { basicActions: { NtS3iThuWWwm8O62: "dash", AeCciDTvw3kS583a: "disengage", NiI5qEhg9TepZxMh: "hide" } },

  // Steady Aim (level 3): Bonus Action that gives Advantage on the next attack of the turn; only if the rogue has not
  // moved yet this turn, and their Speed drops to 0 until the end of the turn. The item's trace carries the Advantage,
  // consumed at the first attack roll, removed at the end of the turn.
  "steady-aim": {
    usageLimits: { VGVYnecMRcu0f5Sq: { unmoved: true } },
    holdsStill: true,
    trace: { activity: "VGVYnecMRcu0f5Sq", show: true },
    triggers: [
      { on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "steady-aim" }, do: [{ type: "advantage" }, { type: "consume", side: "source" }] },
      { on: "endOfTurn", via: "effect", do: [{ type: "remove" }] }
    ]
  },

  // Cunning Strike: the author chooses them before their damage; Poison is repeated at the end of each of the target's turns.
  // §433: the "Poisoned" effect in its two forms — the item's (`RazTM6biKVtNtjEW`: Player's Handbook, SRD up to dnd5e 6.0)
  // and the common effect of the `dnd5e.effects` compendium that the dnd5e 6.1 SRD activity applies in its place
  // (`wAnw5y4atBxNJHUP`).
  "cunning-strike": {
    cunningStrikes: CUNNING_STRIKES,
    triggers: [
      { on: "endOfTurn", via: "effect", fromEffect: "RazTM6biKVtNtjEW", do: [{ type: "resave" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "wAnw5y4atBxNJHUP", do: [{ type: "resave" }] }
    ]
  },
  // §236: Supreme Sneak (Thief 9) — Cunning Strike option Stealth Attack (1d6): Hidden through Hide, the attack does not end it
  // if the rogue ends their turn behind Three-Quarters Cover or Total Cover (runtime/sneak.mjs, runtime/hide.mjs).
  "supreme-sneak": { cunningStrikes: { stealthAttack: { cost: 1, keepsHidden: true } } },
  // §236: Thief's Reflexes (Thief 17) — two turns in the first round, the second at Initiative minus 10 (runtime/roll-bonus.mjs).
  // Use Magic Device (Thief 13), Charges — "whenever you use a magic item property that expends
  // charges, roll 1d6; on a 6, you use it without expending them". The fourth attunement is the item's effect, the
  // reading of any scroll is in adapter/scrolls.mjs.
  "use-magic-device": { savesCharges: { die: 6, on: 6 } },
  "thiefs-reflexes": { extraFirstTurn: { minus: 10 } },
  // Improved Cunning Strike (level 11): "up to two Cunning Strike effects".
  "improved-cunning-strike": { cunningStrikeMax: 2 },
  // Devious Strikes (level 14). Knock Out: "Unconscious for 1 minute or until it takes damage; it repeats the
  // save at the end of each of its turns". Daze: "on its next turn, the target can do only one of
  // these things: move, take an action, or take a Bonus Action" — the item's "Dazed" effect carries it, until
  // the end of that turn.
  "devious-strikes": {
    cunningStrikes: DEVIOUS_STRIKES,
    oneThingPerTurn: "wWFV1p8u9C1TUPg5",
    effectEnds: { wWFV1p8u9C1TUPg5: "bearerTurnEnd" },
    triggers: [
      { on: "endOfTurn", via: "effect", fromEffect: "C2IGgt4PnRMxZVey", do: [{ type: "resave" }] },
      { on: "isDamaged", via: "effect", fromEffect: "C2IGgt4PnRMxZVey", do: [{ type: "remove" }] },
      // §433: "Unconscious" from the `dnd5e.effects` compendium, applied by the activity of the dnd5e 6.1 SRD.
      { on: "endOfTurn", via: "effect", fromEffect: "HjLkxDzLNBogspf9", do: [{ type: "resave" }] },
      { on: "isDamaged", via: "effect", fromEffect: "HjLkxDzLNBogspf9", do: [{ type: "remove" }] }
    ]
  },

  // Evasion (level 7) and Elusive (level 18).
  "evasion": { evasion: true },
  "elusive": { elusive: true },
  // Stroke of Luck (level 20) — "if you fail a d20 Test, you can turn the roll into a 20": once per Short or Long Rest
  // (the item's use, spent by its activity). A 20 obtained this way on an attack is not made a Critical Hit here:
  // the text does not say so, and nothing is added beyond the total.
  "stroke-of-luck": { rollBonus: { activity: "y4PG8Ow1eNEle580", on: ["attack", "save", "check"], reroll: { sets: 20 } } },

  // Assassin (level 3), Assassinate: in the first round of a combat, Advantage against anyone who has not acted yet; a successful
  // Sneak Attack during that round adds as much damage (weapon's type) as the Rogue level.
  "assassinate": {
    sneakBonus: { formula: "@classes.rogue.levels", firstRound: true },
    triggers: [{ on: "preAttackRoll", if: { "target.hasNotActed": true }, do: [{ type: "advantage" }] }]
  }
});
