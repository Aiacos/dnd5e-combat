/**
 * The Sorcerer from the 2024 Player's Handbook (SPEC §32), premium module `dnd-players-handbook` 2.2.0 (`classes` pack,
 * items `phbscr…`, Metamagic options `phbmmo…`).
 *
 * What dnd5e already does by itself: Sorcerous Font (points and conversions), Draconic Resilience, Dragon Wings, Fleshy
 * Revelation, Innate Sorcery (+1 to the DC: the effect), Sorcerous Restoration, the point costs of the Metamagic options.
 */

/** A Metamagic option: its activity retains the kind for the next spell (runtime/metamagic.mjs). */
const meta = (activity, kind) => ({ metamagic: { activity, kind } });

/** Elemental Affinity: "a chosen type" — the one of the Resistance that the feature gave. */
// §438: not when the actor has the Player's Handbook 3.0.0 feature for that type (`elemental-affinity-<type>`):
// its effect already adds Charisma.
const affinity = type => ({ on: "preDamageRoll", if: { "activity.isSpell": true, "activity.dealsType": type, "source.resists": type,
    not: { "source.hasFeature": `elemental-affinity-${type}` } },
  do: [{ type: "damage", formula: "@abilities.cha.mod", damageType: type }] });

/** Transmuted Spell: the six types that can be swapped. */
const TRANSMUTABLE = ["acid", "cold", "fire", "lightning", "poison", "thunder"];

export const SORCERER = Object.freeze({
  // Heightened Spell (Metamagic) — "when you roll a spell's damage, 1 Sorcery Point to reroll up to your
  // Charisma modifier in damage dice (at least one); the new rolls count": offered after the roll, on the low dice.
  // It stacks with another Metamagic option on the same spell: nothing prevents that here either.
  "empowered-spell": { spellDamageRerolls: { activity: "NkEwJOEFigqsdbZy", count: "max(1, @abilities.cha.mod)" } },
  // C12-h: Fleshy Revelation (Aberrant 14), Sparkling Flight — "a Fly Speed equal to your Speed" (the data: double).
  "revelation-in-flesh": { effectChanges: { CxuVthyUWdT2ARMn: [{ key: "system.attributes.movement.fly", type: "upgrade", value: "@walk", replace: true }] } },
  // §124: Bulwark of Law (Clockwork Magic) — "you or another creature you can see within 9 m or less"; "self"
  // in the Player's Handbook data.
  "bastion-of-law": { ranges: { DucJ5vspZD8Yv0gi: { value: 30, units: "ft" } } },
  // Innate Sorcery: "Advantage on the attack rolls of Sorcerer spells you cast" (the DC: the item's effect).
  "innate-sorcery": { triggers: [{ on: "preAttackRoll", if: { "source.hasEffect": "innate-sorcery", "activity.classSpell": "sorcerer" },
    do: [{ type: "advantage" }] }] },
  // Metamagic.
  "quickened-spell": meta("leFbHb9SZwDix2TU", "quickened"),
  "careful-spell": meta("jD3THRjOL2ILRYuM", "careful"),
  "heightened-spell": meta("uHwIuPfMDD9sxVa9", "heightened"),
  "distant-spell": meta("WMoNZCe0IyHlRLM4", "distant"),
  "subtle-spell": meta("9jWUnfRzs0TqKWC2", "subtle"),
  // §296: Clockwork Cavalcade (Clockwork Sorcery 18) — "100 HP distributed among creatures of your choice in the Cube" (9 m
  // Cube from you: the list within 9 m); the shared pool.
  "clockwork-cavalcade": { pickTargets: { activities: ["hcsPW0N4FkiDoaIy", "gVIgwimuEujzofWA"], radius: 30, units: "ft", self: true, check: "allies" },
    healPool: { activities: ["hcsPW0N4FkiDoaIy", "gVIgwimuEujzofWA"], choose: true } },
  // §296: Twinned Spell — "the spell's effective level increases by 1": one more target in the group targeting (ui/pointer.mjs).
  // Sorcerous Incarnation (level 7) — "while your Innate Sorcery is active, up to two Metamagic options on each
  // spell" (only one otherwise: the Metamagic rule); Innate Sorcery regained for 2 points stays the item's activity.
  "sorcery-incarnate": { metamagicRules: { whileEffect: "innate-sorcery", limit: 2 } },
  // Arcane Apotheosis (level 20) — "while your Innate Sorcery is active, one Metamagic option on each of your turns
  // without spending Sorcery Points".
  "arcane-apotheosis": { metamagicRules: { whileEffect: "innate-sorcery", freePerTurn: true } },
  "twinned-spell": meta("WsG9JmGU7gRGiTRq", "twinned"),
  // Seeking Spell (SRD 5.2): "if you make an attack roll for a spell and miss, you can spend 1 Sorcery Point
  // to reroll the d20, and you must use the new roll". Offered after the missed roll (it is not chosen at casting, and applies
  // even if another Metamagic option was used); the item's activity pays the point.
  "seeking-spell": { rollBonus: { activity: "vudKvHh2PbAiDXSE", on: ["attack"], reroll: {}, spellAttack: true } },
  // Extended Spell (Metamagic) — "a spell of at least 1 minute: its duration doubled, 24 hours at most; if it requires
  // Concentration, Advantage on saving throws to maintain it" (runtime/cantrips.mjs when the effects are applied,
  // runtime/feats.mjs at the roll).
  "extended-spell": meta("WGQHGHweOlSpZDHp", "extended"),
  // Transmuted Spell (SRD 5.2): "when you cast a spell that deals a damage type from the list — acid, cold, fire, lightning,
  // poison, thunder —, you can spend 1 Sorcery Point to change that type to one of the others on the list". The
  // other types are offered along with the spell's own, before the damage roll; choosing one pays the point (the item's activity).
  "transmuted-spell": { spellDamageTypes: { types: TRANSMUTABLE, from: TRANSMUTABLE, cost: "FT1V43gRA47fCA51" } },
  // Elemental Affinity (Draconic 6): "+ your Charisma modifier to a damage roll" of a spell of the chosen type.
  "elemental-affinity": { triggers: ["acid", "cold", "fire", "lightning", "poison"].map(affinity) },
  // Psychic Defenses (Aberrant 6): Advantage on saving throws against Charmed and Frightened.
  "psychic-defenses": { saveAdvantage: ["charmed", "frightened"] }
});
