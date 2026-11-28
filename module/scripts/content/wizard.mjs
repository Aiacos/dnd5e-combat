/**
 * The Wizard of the 2024 Player's Handbook (SPEC §28), premium module `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbwzd…`). Already there: Arcane Ward and Projected Ward of the Abjurer (§16.11, content/absorbs.mjs).
 *
 * What dnd5e already does by itself: Scholar, Memorize Spell, Spell Mastery and Signature Spells ("always prepared"
 * enchantments), Third Eye (effects), "Illusory Creatures" (summonings). §139: Arcane Recovery and Ritual Adept
 * below (dnd5e does nothing with them: the Handbook's copy only has a "Recover" activity that spends the use).
 */

export const WIZARD = Object.freeze({
  // §139: Ritual Adept — "any spell in your spellbook that has the Ritual tag, even unprepared, but only as a ritual"
  // (runtime/grimoire.mjs: out of combat, no slot).
  "ritual-adept": { ritualAdept: { class: "wizard" } },
  // §139: Arcane Recovery — on a Short Rest, expended slots whose levels add up to no more than half the Wizard level
  // (rounded up), none of level 6 or higher; once per Long Rest (the item's use).
  "arcane-recovery": { slotRecovery: { class: "wizard", maxLevel: 5 } },
  // Sculpt Spells (Evoker 3): "choose up to 1 + the spell's level creatures: they automatically succeed on their
  // saving throw and take no damage" — the engine picks the caster's allies (same disposition).
  "sculpt-spells": { sculptSpells: true },
  // Potent Cantrip (Evoker 6): "you miss with an attack roll or the target succeeds on its saving throw: half
  // damage, but no additional effect".
  "potent-cantrip": { potentCantrip: true },
  // Overchannel (Evoker 14) — "a wizard spell cast with a level 1 to 5 slot that deals damage: maximum damage on the
  // turn you cast it; from the second time before a Long Rest, 2d12 necrotic damage per level of the slot (+1d12 per level each
  // time), which ignores Resistance and Immunity". Offered after the damage roll; the counter is the item's (its uses,
  // reset to zero on a Long Rest). A spell with no class noted is allowed.
  "overchannel": { overchannel: { class: "wizard", maxLevel: 5, die: 12 } },
  // Empowered Evocation (Evoker 10): "add your Intelligence modifier to a damage roll" of an Evocation spell.
  "empowered-evocation": { triggers: [{ on: "preDamageRoll", if: { "activity.isSpell": true, "activity.school": "evo" },
    do: [{ type: "damage", formula: "@abilities.int.mod", damageType: "weapon" }] }] },
  // Illusory Self (Illusionist 10): as a Reaction, an attack roll that hit the wizard is turned into a miss —
  // the "Interpose" activity (one use per Short Rest).
  "illusory-self": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "DEHSJ0MTQQkQ99wp" }, { type: "miss" }] }] },
  // Spell Resistance (Abjurer 14): Advantage on saves against spell magic; Resistance to spell damage
  // is left to the GM (dnd5e has no "spell damage" type).
  "spell-resistance": { saveAdvantage: ["magic"] },
  // Projected Ward (Abjurer 6, `phbwzdProjectedW`): as a Reaction, the wizard's Arcane Ward takes on the damage dealt
  // to a visible creature within 30 ft (§38) — the "Project Ward" activity (reaction, 1 use of the ward in the
  // data) is used without consuming anything: the pool pays, for the amount absorbed.
  "projected-ward": { triggers: [{ on: "allyIsDamaged", if: { "target.nearSelf": { distance: 30, units: "ft" }, "self.seesTarget": true },
    do: [{ type: "use", activity: "THaODa86JJaeoWfL", consume: false }, { type: "absorb" }] }] },
  // Portent (Diviner 3): two d20s rolled on each Long Rest and kept in reserve; each can replace the result of a D20 Test
  // of the diviner or of a creature they see, chosen before the roll, at most once per turn (§36) — the engine rolls them on a
  // Long Rest and offers to replace the attack roll or the save they see coming. Greater Portent (Diviner 14): three d20s; the
  // highest number wins.
  "portent": { portent: { dice: 2 } },
  "greater-portent": { portent: { dice: 3 } }
});
