/**
 * The Paladin of the Player's Handbook 2024 (SPEC §25), and the smite spells. Items of the premium module
 * `dnd-players-handbook` 2.2.0 (packs `classes`: `phbpdn…`, `spells`).
 * Aura of Protection: already there (§16, content/auras.mjs).
 *
 * What dnd5e already does by itself: Lay On Hands (healing, poison removal — except the range, below), Radiant Strikes
 * (effect: +1d8 radiant to melee weapon attacks),
 * Sacred Weapon (enchantment: Charisma to the attack, radiant damage of choice), free Divine Smite once per Long Rest (the
 * use of the spell item).
 *
 * `smite` (§25): a smite spell is cast "immediately after hitting a target with a melee weapon or an Unarmed
 * Strike", as a Bonus Action. The engine offers it at the damage roll of that hit: `damage` is the spell's damage activity
 * (its dice, at the cast level, are added to the roll and doubled on a Critical Hit), `fiends` the one that applies against
 * a Fiend or an Undead (Divine Smite), `save` the saving throw the target then makes (Prone, Frightened, Blinded…).
 */

/** "You and your allies in your Aura of Protection": same radius as the Aura of Protection (level 18: 9 m). */
const auraImmunity = status => ({ includeSelf: true, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft",
  changes: [{ key: "system.traits.ci.value", value: status, type: "add" }] });

/** The Lay On Hands activities of the Player's Handbook: Heal, Remove Poison. */
const LAY_ON_HANDS = ["gXZh9aGHcywV9huC", "K6UeXQwTyDHWvis8"];

/** Divine Sense: the location of Celestials, Fiends and Undead within 18 m — as long as the effect of Channel Divinity lasts. */
const DIVINE_SENSE = { sense: { kind: "locate", range: 60, units: "ft", via: "effect", fromEffect: "hr8wnlgs3uXphCnI", walls: false,
  magic: true, detects: { "target.creatureType": ["celestial", "fiend", "undead"] } } };

export const PALADIN = Object.freeze({
  // The Paladin's Channel Divinity: `channel-divinity-paladin` (dnd5e 6.1 SRD), `channel-divinity` (Player's Handbook).
  "channel-divinity-paladin": DIVINE_SENSE,
  "channel-divinity": DIVINE_SENSE,
  // §123: Lay On Hands — "touch a creature (yourself included)"; the Player's Handbook data say "self",
  // and the engine always healed the paladin. On touch: targeting opens, you click the creature (self included).
  // §296: Inspiring Smite — "2d8 + Paladin level Temporary Hit Points distributed among creatures of your choice within 9 m,
  // yourself included".
  "inspiring-smite": { pickTargets: { activities: ["oBkPCmC2KsH2WUJp"], radius: 30, units: "ft", self: true, check: "allies" },
    healPool: { activities: ["oBkPCmC2KsH2WUJp"], temp: true } },
  // §298: Sacred Weapon — "when you take the Attack action, you can expend a use of Channel Divinity": no action cost
  // (the data says "action", the paladin could no longer attack that turn).
  "sacred-weapon": { usageLimits: { Ew70lNTD8dR3vREt: { cost: "free" } } },
  // §295: "5 points from the pool to remove the Poisoned condition" — the "Remove Poison" activity pays without removing anything.
  // C12-g: Restoring Touch (Paladin 14) — "you can also end one or more of these conditions: Blinded, Charmed, Deafened,
  // Frightened, Paralyzed, Stunned": one of your choice (several, up to the player, for 5 points each).
  "restoring-touch": { ranges: { PgTPWedvQHDlQ7LQ: { value: 5, units: "ft" } }, cures: ["blinded", "charmed", "deafened", "frightened", "paralyzed", "stunned"], curesOn: "PgTPWedvQHDlQ7LQ" },
  "lay-on-hands": { ranges: Object.fromEntries(LAY_ON_HANDS.map(id => [id, { value: 5, units: "ft" }])), cures: ["poisoned"], curesOn: "K6UeXQwTyDHWvis8" },
  // §124: Elder Champion and Holy Nimbus — "imbue your Aura of Protection": the transformation (its effect) is for the
  // paladin, even though the data say "a creature". No targeting.
  "elder-champion": { ranges: { qRy5KFVY3qomQlp5: { units: "self" } } },
  "holy-nimbus": { ranges: { k6gGbWQBoLTgqbSG: { units: "self" } } },
  // Smite spells (PHB 2024) — Divine Smite: 2d8 radiant (+1d8 per level), 3d8 against a Fiend or an Undead.
  "divine-smite": { smite: { damage: "dnd5eactivity200", fiends: "dnd5eactivity000" } },
  // §273: Smite of Protection (paladin, PHB 2024) — "whenever you cast Divine Smite, you and your
  // allies gain Half Cover within your Aura of Protection, until the start of your next turn". The data has only an inactive
  // passive effect ("Smite of Protection", Half Cover condition, to be turned on by hand):
  // the Divine Smite that hits applies it to the paladin until the start of the paladin's next turn, and an aura with the
  // radius of the Aura of Protection applies a copy to the allies.
  "smite-of-protection": {
    afterSmite: { effect: "EyWEQv8qPwbXyDmA", smites: ["divine-smite"] },
    effectEnds: { EyWEQv8qPwbXyDmA: "casterTurnStart" },
    aura: { whileActive: true, includeSelf: true, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft", effect: "EyWEQv8qPwbXyDmA" }
  },
  // Searing Smite (1d6 fire; §42.2: the lasting burn, "Seared" effect, applied on the hit — its follow-up in
  // content/triggers.mjs), Shining Smite (2d6 radiant; the "Shining" mark remains with the GM).
  "searing-smite": { smite: { damage: "M4KS57lcf4K6fUMU", effect: "A0tTvLeRetrC708K" } },
  // §157: the "Shining" effect (pBjrcT286iCAQrjm: cannot be Invisible) applied to the target hit; the Advantage against it and its
  // light: content/spell-rules.mjs, content/lights.mjs.
  "shining-smite": { smite: { damage: "dnd5eactivity000", effect: "pBjrcT286iCAQrjm" } },
  // Thunderous Smite (2d6 thunder; Strength save or Prone), Wrathful Smite (1d6 necrotic; Wisdom save or Frightened),
  // Staggering Smite (4d6 psychic; Wisdom save),
  // Banishing Smite (5d10 force; Charisma save or banished).
  "thunderous-smite": { smite: { damage: "dnd5eactivity000", save: "dnd5eactivity100" } },
  "wrathful-smite": { smite: { damage: "7g4z2R5Xozd8TESe", save: "dnd5eactivity000" } },
  // Blinding Smite (3d8 radiant): Blinded without a save on the hit — its save (dnd5eactivity100) is the end-of-turn one,
  // which remains with the GM like the condition.
  // §42.2: the blinding ("Blinded"), applied on the hit; the end-of-turn save in content/triggers.mjs.
  "blinding-smite": { smite: { damage: "dnd5eactivity000", effect: "5FPaEGhqJ5yPP2Ln" } },
  "staggering-smite": { smite: { damage: "AMwFB1wsbzWYakK4", save: "dnd5eactivity000" } },
  // §262: "if the attack reduces the target to 50 Hit Points or fewer, it must succeed on a Charisma saving throw".
  "banishing-smite": { smite: { damage: "CXmmXBTfen6D6LXY", save: "dnd5eactivity000", saveAtMostHp: 50 } },

  // C12-b: Aura of Warding (Oath of the Ancients 7) — "you and your allies in your Aura of Protection have Resistance to
  // necrotic, psychic and radiant damage": the data gives it only to the paladin (transferred effect); a copy to the aura's
  // allies.
  "aura-of-warding": { aura: { includeSelf: false, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft", effect: "eJVeoCZ0lno8xK6O" } },
  // C12-b: Aura of Alacrity (Oath of Glory 7) — "your Speed increases by 3 m; an ally that enters your Aura of Protection or
  // starts its turn there gains 3 m of Speed until the end of its next turn": +3 m while in the aura (simplification),
  // yourself included (the data's key, `movement.speed`, is a derived value that dnd5e rewrites: no effect).
  "aura-of-alacrity": { aura: { includeSelf: true, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft",
    changes: [{ key: "system.attributes.movement.walk", value: "10", type: "add" }] } },
  // Aura of Courage (level 10): immunity to Frightened; Aura of Devotion (Oath of Devotion 7): immunity to Charmed.
  "aura-of-courage": { aura: auraImmunity("frightened") },
  "aura-of-devotion": { aura: auraImmunity("charmed") },
  // Vow of Enmity (Oath of Vengeance 3): the paladin attacks the target creature with Advantage — the "Vow of Enmity" effect
  // it carries, coming from the paladin.
  // §236: Soul of Vengeance (Vengeance 15) — "immediately after a creature under the effect of your Vow of Enmity hits or
  // misses with an attack roll, you can take a Reaction to make a melee attack against it if it is within range"
  // (at 1.50 m: the ordinary reach; a weapon with reach is not counted).
  "soul-of-vengeance": { triggers: [{ on: "enemyAttacked", if: { "source.hasEffectFromTarget": "vow-of-enmity", "target.within": { distance: 5, units: "ft" } },
    do: [{ type: "use", target: "source", weapon: true }] }] },
  "vow-of-enmity": { triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffectFrom": "vow-of-enmity" }, do: [{ type: "advantage" }] }] },
  // Abjure Foes (level 9): "Frightened for 1 minute or until it takes damage".
  "abjure-foes": { triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }] },
  // §92: Avenging Angel (Oath of Vengeance 20), Frightful Aura — as long as Avenging Angel is active
  // (its effect on the paladin), an enemy that starts its turn in the Aura of Protection makes the Wisdom save of
  // "Frightful Aura", Frightened for 1 minute "or until it takes damage"; "attack rolls against the Frightened creature have
  // Advantage". The flight: the data's effect.
  "avenging-angel": {
    emanation: { on: "turnStart", affects: "enemy", activity: "UV3wzKmXpqDjWDAy", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft", whileActive: true },
    triggers: [
      { on: "isDamaged", via: "effect", fromEffect: "ucmM8P37dhbuz8eK", do: [{ type: "remove" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "ucmM8P37dhbuz8eK", if: { "target.hasEffect": "avenging-angel" }, do: [{ type: "advantage" }] },
      // §438: Player's Handbook 3.0.0 — the aura applies the common Frightened of the `dnd5e.effects` compendium
      // (`OpCz3oGBfDZfxAlt`), not an effect of the item.
      { on: "isDamaged", via: "effect", fromEffect: "OpCz3oGBfDZfxAlt", do: [{ type: "remove" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "OpCz3oGBfDZfxAlt", if: { "target.hasEffect": "avenging-angel" }, do: [{ type: "advantage" }] }
    ]
  }
});
