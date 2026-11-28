/**
 * The 2024 Player's Handbook Bard (SPEC §33), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbbrd…`).
 * Bardic Inspiration itself (the die added to a failed roll by the inspired creature) is held by the engine outside the content:
 * adapter/inspiration.mjs, runtime/engine.mjs.
 *
 * What dnd5e already does alone: Bardic Inspiration given (activity, "Inspired" effect, uses), Jack of All Trades, Expertise,
 * Font of Inspiration, Dazzling Footwork (AC, unarmed strike), Mantle of Inspiration (Temporary Hit Points), Extra Attack
 * (budget), the colleges' always-prepared spells.
 */

export const BARD = Object.freeze({
  // §298: Extra Attack (College of Valor 6) — "one of your cantrips with a casting time of one action in place of one of
  // the attacks".
  "valor-extra-attack": { spellsInAttack: { maxLevel: 0 } },
  // Cutting Words (Lore 3): "when a creature you can see within 18 m succeeds on an attack roll, your Reaction and one
  // Inspiration: roll the die and subtract the result from the roll" — offered when the attack hits the bard or an ally; the attack
  // is re-judged (the die is worth that much AC). Checks and damage rolls stay with the player.
  // §301: "a creature you can see within 18 m" — the attacker, seen by and within range of the bard (hit itself: `target` = the
  // bard).
  "cutting-words": { triggers: [
    { on: "isHit", if: { "target.within": { distance: 60, units: "ft" }, "target.seesSource": true }, do: [{ type: "use" }, { type: "penalty", formula: "@scale.bard.inspiration" }] },
    { on: "allyIsHit", if: { "source.nearSelf": { distance: 60, units: "ft" }, "self.seesSource": true }, do: [{ type: "use" }, { type: "penalty", formula: "@scale.bard.inspiration" }] }
  ] },
  // §301: Countercharm (level 7) — "you fail a saving throw against an effect that inflicts Charmed or Frightened: your
  // Reaction, reroll it" (offered on a failed save to avoid or end one of these conditions), "and the new roll has Advantage".
  // Simplification: a creature within 9 m that fails its own is not covered.
  "countercharm": { rollBonus: { activity: "dnd5eactivity000", on: ["save"], statuses: ["charmed", "frightened"],
    reroll: { advantage: true } } },
  // Leading Evasion (Dance 14): the Evasion (§20); sharing it with a creature within 1.50 m stays with the player.
  "leading-evasion": { evasion: true },
  // Combat Inspiration (Valor 3): the creature inspired by this bard adds the die to the damage of a hit, or to its AC with its
  // Reaction when it is hit (adapter/inspiration.mjs) — instead of adding it to a failed roll, which remains possible.
  "combat-inspiration": { combatInspiration: true },
  // Peerless Skill (Lore 14) — "when you fail an ability check or an attack roll, you can expend a Bardic Inspiration use,
  // roll the die and add it to the d20; on a failure, the Inspiration is not expended" (`failRefund`). On a check with no known
  // DC, the question is asked as soon as the roll is made and nothing is refunded: the engine does not know if it is a failure.
  "peerless-skill": { rollBonus: { activity: "dnd5eactivity000", on: ["attack", "check"], failRefund: true } },
  // §236: Superior Inspiration (level 18) — "when you roll Initiative, you regain Bardic Inspiration uses
  // until you have two".
  // C12-j: Font of Inspiration (Bard 5) — "you regain all your expended Bardic Inspirations after a Short or Long Rest".
  "font-of-inspiration": { regainOnShortRest: ["bardic-inspiration"] },
  "superior-inspiration": { regainOnInitiative: { item: "bardic-inspiration", upTo: 2 } }
});
