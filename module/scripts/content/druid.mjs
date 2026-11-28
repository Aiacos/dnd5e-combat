/**
 * The Druid of the 2024 Player's Handbook (SPEC §30), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbdrd…`).
 * Already there: Wild Shape (§19.x, runtime/wildshape.mjs), Wild Companion, Wild Resurgence.
 *
 * What dnd5e already does by itself: Circle Forms (transformation), Improved Circle Forms (Constitution saving throws),
 * Nature's Ward, Star Plenitude, Child of the Storm, Aquatic Affinity (effects), Starry Form (Archer, Chalice,
 * Dragon: activities and effects), Land's Aid (save and healing), Archdruid.
 */

/** Primal Strike: "an attack roll with a weapon or a Beast attack while in Wild Shape". */
const primalHit = { any: [{ "activity.isWeapon": true }, { "source.wildShaped": true, "activity.isAttack": true }] };
/**
 * Primal Strike, not for a druid who received the Potent Spellcasting option (Handbook item; gap survey, 2026-10-22) — §431:
 * under the identifier of the Handbook and of the dnd5e 6.0 SRD or under that of the 6.1 SRD (`potent-spellcasting`, shared with
 * the Cleric: the Druid's only).
 */
const POTENT_IDS = ["elemental-fury-potent-spellcasting", "potent-spellcasting"];
const potentOption = { any: [{ "source.hasFeature": POTENT_IDS[0] }, { "source.hasClassFeature": { id: POTENT_IDS[1], class: "druid" } }] };
const primalStrike = (formula, improved) => ({ on: "preDamageRoll", oncePerTurn: true,
  if: { all: [primalHit, { not: potentOption },
    improved ? { "source.hasFeature": "improved-elemental-fury" } : { not: { "source.hasFeature": "improved-elemental-fury" } }] },
  do: [{ type: "damage", formula, damageType: "fire" }] });

/**
 * Potent Spellcasting, the other Elemental Fury option: "add your Wisdom modifier to the damage of any Druid cantrip". The
 * Druid's advancement gives only "Elemental Fury" (Primal Strike by default); the Handbook has one item per option
 * ("Elemental Fury: Potent Spellcasting", `elemental-fury-potent-spellcasting`): placed on the sheet, it carries the rule and
 * removes the Primal Strike. Same rule for the Cleric (gap survey, 2026-10-22 — before, the world overlay was needed,
 * and the Strike stayed).
 * §431: the item of the dnd5e 6.1 SRD (`potent-spellcasting`) itself carries an effect that adds Wisdom to the cantrips of its
 * class (`damage` / `dnd5e.bonus` change, `item.classIdentifier` condition): no entry under that name, otherwise the bonus
 * would count twice.
 */
export const potentSpellcasting = cls => ({ triggers: [{ on: "preDamageRoll", if: { "activity.cantripOf": cls },
  do: [{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }] }] });

/** Wrath of the Sea (Sea 3): on a failed save, besides the cold damage, a target of Large size or smaller is pushed
 * 4.50 m away from the druid. Child of the Storm (Sea 14) takes up the same save (its activity). */
const seaPush = { triggers: [{ on: "failedSave", if: { "target.sizeAtMost": "lg" }, do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }] };

export const DRUID = Object.freeze({
  // Archdruid (level 20), Evergreen Wild Shape — "when you roll Initiative and have no Wild Shape uses left, you regain one":
  // like Superior Inspiration, without asking anything. The other half (Nature Magician: uses converted into a spell slot)
  // stays the item's activity.
  "archdruid": { regainOnInitiative: { item: "wild-shape", upTo: 1 } },
  // C12-c: Improved Circle Forms (Moon 6) — "while in a Wild Shape, add your Wisdom modifier to your Constitution saving throws":
  // the data's effect, switched off, is switched on only under Wild Shape.
  "improved-circle-forms": { effectWhile: { yvjaO9R5qoRxtDKY: { if: { wildShaped: true } } } },
  // C12-c: Star Plenitude (Stars 14) — "while in your Starry Form, Resistance to Bludgeoning, Piercing and Slashing damage":
  // the data's effect, switched on as long as an effect of the Starry Form is active.
  "full-of-stars": { effectWhile: { Z3dPVHxaYqTIvLPg: { if: { hasEffect: "starry-form" } } } },
  // Cosmic Omen (Stars 6): as a Reaction, facing the D20 Test of a visible creature within 9 m or less, the druid rolls a d6 and
  // subtracts it (Woe, against an enemy's attack roll, §34) or adds it (Weal, to an ally's
  // attack roll, §36). The sheet does not keep the omen of the day (even or odd): each window offers the activity that
  // suits it, and the player takes only their own. Checks other than an attack are left to the player.
  "cosmic-omen": { triggers: [
    { on: "enemyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
      do: [{ type: "use", activity: "RUVw6UxNL4FIdDrJ" }, { type: "penalty", formula: "1d6" }] },
    { on: "allyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
      do: [{ type: "use", activity: "nu3AqVu9lyqeFwr3" }, { type: "bonus", formula: "1d6" }] }
  ] },
  // §300: "choose another creature you can see in the Emanation" — only one, at the manifestation as at the next turn.
  // §438: the radius (1.50 m, 3 m at level 6) read from the Druid level — the scale `@scale.sea.wrath-range` is gone from
  // Handbook 3.0.0.
  // §438 continued: Handbook 3.0.0 — "Manifest Ocean Spray" (`nNTY…`) is a utility (Emanation, Tempest) and the save is the sister
  // `9U9A…`: the list opens right after the manifestation, around the druid, and the save goes out without a second Bonus Action
  // (`after`, user decision of 2026-11-14: "when you manifest the Emanation"). Level 14 ("Another", `ituof…`, formerly Ocean
  // Gift): the Emanation (3 m) around another creature, which carries the item's effect — the list opens around it, and on the
  // following turns the save offers the creatures around the druid AND around whoever carries the effect (`bearers`). Form
  // 2.2.0: `nNTY…` is the save itself (list before the use, nothing chained).
  "wrath-of-the-sea": { ...seaPush, pickTargets: { activities: ["nNTYj4vqURV4Dhjt", "9U9AoJYvcrCQtIMm"], radius: "5 + 5 * min(1, floor(@classes.druid.levels / 6))", units: "ft", max: 1, check: "enemies",
    after: { nNTYj4vqURV4Dhjt: { activity: "9U9AoJYvcrCQtIMm", around: "self" }, ituofBRxXKLI7wNW: { activity: "9U9AoJYvcrCQtIMm", around: "targets" } },
    bearers: { radius: 10, units: "ft" } } },
  // §295: Nature's Ward (Circle of the Land 10) — "Immunity to the Poisoned condition"; the data carries only the Resistances.
  "natures-ward": { grantsConditionImmunities: ["poisoned"] },
  // Natural Recovery (Circle of the Land 6, SRD 5.2): "at the end of a Short Rest, expended slots whose levels add up to no
  // more than
  // half your Druid level (rounded up), none of 6th level or higher; once per
  // Long Rest". The data's "Recover Spell Slots" activity only counts its use: it is the one that is
  // spent.
  "natural-recovery": { slotRecovery: { class: "druid", maxLevel: 5, activity: "u0UF6WePUutyp6e6" } },
  "stormborn": { ...seaPush, pickTargets: { activities: ["jOppnQcyBPpUizBN"], radius: "5 + 5 * min(1, floor(@classes.druid.levels / 6))", units: "ft", max: 1, check: "enemies" } },
  // Elemental Fury (level 7), Primal Strike option: "once on each of your turns, 1d8 fire, lightning, cold or thunder damage" —
  // fire by default (the choice is not asked); 2d8 with Improved Elemental Fury (level 15).
  "elemental-fury": { triggers: [primalStrike("1d8", false), primalStrike("2d8", true)] },
  "elemental-fury-potent-spellcasting": potentSpellcasting("druid"),
  // §236: Improved Elemental Fury (level 15) — the Primal Strike goes to 2d8 ("elemental-fury"); Potent Spellcasting: "a Druid
  // cantrip with a range of at least 3 m reaches 90 m farther" (adapter/turn.mjs, `rangeOf`).
  "improved-elemental-fury": { cantripRange: { class: "druid", add: { value: 300, units: "ft" }, requires: POTENT_IDS } },
  // Lunar Form (Moon 10), improved Lunar Radiance: a hit made under Wild Shape adds 2d10 radiant, at most once per
  // turn.
  "lunar-form": { triggers: [{ on: "preDamageRoll", oncePerTurn: true, if: { "source.wildShaped": true, "activity.isAttack": true },
    do: [{ type: "damage", formula: "2d10", damageType: "radiant" }] }] },
  // Lunar Stride (Moon 6): teleportation of 9 m at most, then Advantage on the druid's next attack in that same turn —
  // the destination is chosen right away (§16.10); the trace placed on the druid carries the Advantage, consumed.
  "moonlight-step": {
    teleport: { distance: 30, units: "ft", activity: "dnd5eactivity000" },
    // The item's effect ("follow the Advantage") is disabled and the activity targets a cell: the engine places its trace on
    // the druid, like Steady Aim (§20).
    trace: { activity: "dnd5eactivity000", show: true },
    triggers: [
      { on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "moonlight-step" }, do: [{ type: "advantage" }, { type: "consume", side: "source" }] },
      { on: "endOfTurn", via: "effect", do: [{ type: "remove" }] }   // "before the end of this turn", like Steady Aim (§20)
    ]
  }
});
