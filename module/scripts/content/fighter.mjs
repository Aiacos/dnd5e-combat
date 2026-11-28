/**
 * The Fighter of the 2024 Player's Handbook (SPEC §21), premium module `dnd-players-handbook` 2.2.0 (packs `classes`, items
 * `phbftr…`, and `feats` for the fighting styles). Vocabulary of the French PHB: Action Surge, Second Wind, Tactical Shift,
 * Studied Attacks, Hero of the Field of Honor, Great Weapon Fighting and Thrown Weapon Fighting styles.
 *
 * What dnd5e already does by itself: Second Wind (healing 1d10 + level, Bonus Action), Extra Attack (the engine's budget
 * counts the attacks: adapter/turn.mjs, `attacksPerAction`), Improved Critical (threshold 19, the item's effect), Archery,
 * Defense, Dueling, Blind Fighting styles (effects). The weapon masteries: runtime/mastery.mjs.
 */

export const FIGHTER = Object.freeze({
  // Remarkable Athlete (Champion 3): Advantage on Initiative and on Athletics is dnd5e's flag; "right after a Critical Hit,
  // you can move up to half your Speed without provoking Opportunity Attacks" — on its turn (runtime/feats.mjs).
  "remarkable-athlete": { critMove: true },
  // §123: Rally (Purple Dragon Knight) — "an ally within 9 m or less"; Interception (fighting style) — "another
  // creature within 1.50 m of you". "Personal" in the Player's Handbook data.
  "rally": { ranges: { uyAnJsUHU2Aek9Lk: { value: 30, units: "ft" } } },
  // §301: Interception — "when a creature you can see hits another creature within 1.50 m of you with an attack roll, your
  // Reaction reduces the damage by 1d10 + your proficiency bonus; you wield a shield or a Simple or Martial weapon" — before
  // the damage.
  "interception": { ranges: { Hjm3PZRt6NdVXiFa: { value: 5, units: "ft" } },
    triggers: [{ on: "allyIsHit", if: { "target.nearSelf": { distance: 5, units: "ft" }, "target.isSelf": false, "self.seesSource": true,
      any: [{ "self.hasShield": true }, { "self.wieldsWeapon": true }] },
      do: [{ type: "use", activity: "Hjm3PZRt6NdVXiFa", target: "target" }, { type: "reduce" }] }] },
  // §301: Tactical Mind (level 2) — a failed check: spend Second Wind to add 1d10; if it still fails, the use comes back.
  // Survivor (Champion 18) — Defy Death: "an 18 to 20 on a death saving throw counts as a 20" (the Advantage is the
  // item's effect); Heroic Rally: "at the start of each of your turns, you regain 5 + your Constitution modifier
  // Hit Points if you are Bloodied and have at least 1 Hit Point" — the item's healing activity.
  "survivor": { deathSaveCritical: 18, turnStartHeal: { activity: "5Fo0QwzexIPyLP3W", bloodied: true } },
  "tactical-mind": { rollBonus: { activity: "VVEGPoQePVprCF9A", on: ["check"], failRefund: true } },
  // Action Surge: "on your turn, you can take one additional action, except the Magic action"; at level 17, two uses
  // but only one per turn. The activity ("special" activation) costs nothing to the budget; the engine adds the action to it.
  "action-surge": { grantsAction: true, usageLimits: { jtpVG47zPBUI0CZ5: { oncePerTurn: true } } },
  // Tactical Shift (level 5): "whenever you activate Second Wind with a Bonus Action, you can move up to
  // half your Speed without provoking Opportunity Attacks".
  "tactical-shift": { movesAfter: "second-wind" },
  // §298 (pass C3) — Indomitable (Fighter 9): "reroll a failed saving throw, with a bonus equal to your Fighter level, and
  // use the new roll"; offered after the failed save, at no action cost (the data says "action", without consumption).
  "indomitable": { rollBonus: { activity: "84EBzlT1nDmNqhqM", on: ["save"], reroll: { bonus: "@classes.fighter.levels" } },
    usageLimits: { "84EBzlT1nDmNqhqM": { cost: "free" } } },
  // War Magic (Eldritch Knight 7): "replace one of the attacks of the Attack action with a Wizard cantrip";
  // Improved War Magic (18): "two of the attacks with a Wizard spell of level 1 or 2".
  "war-magic": { spellsInAttack: { maxLevel: 0, class: "wizard" } },
  "improved-war-magic": { spellsInAttack: { maxLevel: 2, class: "wizard", attacks: 2 } },
  // Psionic Energy, Psionic Strike (Psi Warrior 3): "once on each of your turns, right after hitting a target with a
  // weapon" — offered on the hit, paid with a Psionic Energy die, at no action cost (the data says "action").
  // §301: Protective Field — "when you or a creature you can see within 9 m takes damage, your Reaction and a die: reduced by
  // the die + Int" — offered when the attack hits, before the damage (damage without an attack roll is left to the player).
  // The Rogue Soulknife shares the identifier: without this activity, nothing is offered to it.
  "psionic-power": { hitRider: { pays: "psionic-power", damage: "FxJXB4BPlBnJLF7q", oncePerTurn: true },
    usageLimits: { FxJXB4BPlBnJLF7q: { cost: "free" } },
    triggers: [
      { on: "isHit", do: [{ type: "use", activity: "IasIclPwvvEjwvzf" }, { type: "reduce" }] },
      { on: "allyIsHit", if: { "target.nearSelf": { distance: 30, units: "ft" }, "target.isSelf": false, "self.seesTarget": true },
        do: [{ type: "use", activity: "IasIclPwvvEjwvzf", target: "target" }, { type: "reduce" }] }
    ] },
  // Studied Attacks (level 13): "if you miss a creature with an attack roll, you have Advantage on your next attack
  // roll against it before the end of your next turn" — a mark, like Opening (runtime/mastery.mjs).
  "studied-attacks": { studiedAttacks: true },
  // Hero of the Field of Honor (Champion 10): "in combat, you can give yourself Heroic Inspiration whenever you
  // start your turn without it".
  "heroic-warrior": { heroicWarrior: true },
  // Great Weapon Fighting style: "when you roll the damage of an attack with a melee weapon held in two hands, you
  // can treat any 1 or 2 on a damage die as a 3 — the weapon must have the Two-Handed or Versatile property".
  "great-weapon-fighting": { greatWeaponFighting: true },
  // Thrown Weapon Fighting style: +2 to the damage of a ranged hit made with a Thrown weapon.
  "thrown-weapon-fighting": { thrownDamage: 2 },

  // §87: Battle Master maneuvers that play on a hit — "when you hit a creature with an attack roll, you can
  // expend a Superiority Die": the question of the smites at the damage roll (adapter/smite.mjs, only one per hit, like the rule:
  // one maneuver per attack), paid by Martial Superiority (`pays`); the die, from the maneuver's "Superiority Die" activity,
  // of the weapon's damage type; then the maneuver's save on the target still standing, and what a failure does.
  // Disarming Attack: Strength or drop an item (its melee weapon: `disarm` step).
  "disarming-attack": {
    hitRider: { pays: "combat-superiority", damage: "mlUC7IiS8ZyTvDpZ", save: "5y3EDGj0EGN3xVzO", weaponDamage: true },
    triggers: [{ on: "failedSave", do: [{ type: "disarm" }] }]
  },
  // Distracting Strike: "the next attack roll against the target by someone other than you has Advantage, before the start of your
  // next turn" — the "Distracted" effect (GrJWQnC7ueEa7U4l), consumed by that attack.
  "distracting-strike": {
    hitRider: { pays: "combat-superiority", damage: "DBgCFax1iS3mobyw", effect: "GrJWQnC7ueEa7U4l", weaponDamage: true },
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "distracting-strike", not: { "target.hasEffectFrom": "distracting-strike" } },
      do: [{ type: "advantage" }, { type: "consume", side: "target" }] }]
  },
  // Goading Attack: Wisdom or "Disadvantage on attack rolls against a target other than you until the end of your next
  // turn" — the save's "Goaded" effect (bJjBbuJ2PZKby1Nt); its share of damage (the die, doubled) is not rolled.
  "goading-attack": {
    hitRider: { pays: "combat-superiority", damage: "IxCIr1UxK0rqi5De", save: "YZDchvLnuCD6xMkF", weaponDamage: true },
    noDamage: ["YZDchvLnuCD6xMkF"],
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "source.hasEffect": "goading-attack", not: { "source.hasEffectFromTarget": "goading-attack" } },
      do: [{ type: "disadvantage" }] }]
  },
  // Menacing Attack: Wisdom or Frightened until the end of your next turn (the save's effect, duration §79).
  "menacing-attack": { hitRider: { pays: "combat-superiority", damage: "DCKmEG3Vy2gvxpKH", save: "b6LpZcPAmrfgo5hc", weaponDamage: true } },
  // Pushing Attack: a target of Large size or smaller — Strength or pushed 4.50 m.
  "pushing-attack": {
    hitRider: { pays: "combat-superiority", damage: "E8n2vBez77Swvt8l", save: "IFAKr2EogbOKzFSk", sizeAtMost: "lg", weaponDamage: true },
    triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }]
  },
  // Trip Attack: a target of Large size or smaller — Strength or Prone.
  "trip-attack": {
    hitRider: { pays: "combat-superiority", damage: "vOstpOszbeITGlUP", save: "EVY5IoXOorEfQbCr", sizeAtMost: "lg", weaponDamage: true },
    triggers: [{ on: "failedSave", do: [{ type: "status", status: "prone" }] }]
  },
  // Maneuvering Attack: the die to the damage; "an ally can move up to half their Speed as a Reaction without provoking
  // an Opportunity Attack from the target": left to the GM.
  "maneuvering-attack": { hitRider: { pays: "combat-superiority", damage: "y91hZshSUPoqsrpq", weaponDamage: true } },
  // §88: Parry (maneuver) — "when another creature deals damage to you with a melee attack roll, your Reaction and a
  // die reduce the damage by the die + Strength or Dexterity": the "heal" activity (F4UxiihGgkdv4orJ, die + max(Str, Dex), one
  // Superiority Die) gives the amount removed, like the Monk's Deflect Attacks.
  "parry-maneuver": { triggers: [{ on: "isHit", if: { "activity.isMelee": true }, do: [{ type: "use", activity: "F4UxiihGgkdv4orJ" }, { type: "reduce" }] }] },
  // §88: Riposte — "when a creature misses you with a melee attack roll, your Reaction and a die: a melee
  // attack with a weapon or unarmed against it; if you hit, the die is added to the damage": the "Riposte Damage" activity
  // (QhxT9ZuZXmHGlrnT) pays the die and gives it; the attack is the weapon's (`weapon`).
  // §89: Bonus Action maneuvers. Lunging Attack: Dash, and the die promised to the next melee hit of the turn ("if you
  // move at least 1.50 m in a straight line right before": not checked); the "damage" activity rolls nothing by itself.
  "lunging-attack": { basicActions: { aoTn3UKohm5VAuIT: "dash" }, noDamage: ["aoTn3UKohm5VAuIT"], pendingDie: { activity: "aoTn3UKohm5VAuIT", against: "melee" } },
  // Feinting Attack: a creature within 1.50 m — "Advantage on your next attack roll against it this turn; if it hits, the die
  // to the damage". The "damage" activity does not hurt: it places the "Feinting Attack" effect (O7ho6H0UL2rg3Mz9) on the
  // target, which the author's next attack consumes with the Advantage; the die is promised against it.
  "feinting-attack": {
    noDamage: ["Utu8uaZOMepShbyw"],
    pendingDie: { activity: "Utu8uaZOMepShbyw", against: "target" },
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffectFrom": "feinting-attack" }, do: [{ type: "advantage" }, { type: "consume", side: "target" }] }]
  },
  // Evasive Footwork: Disengage, and the Superiority Die added to AC until the start of your next turn (the
  // "Evasive AC" effect, empty in the data).
  "evasive-footwork": { basicActions: { d3RqzIKzhqX82OwP: "disengage" }, rolledAc: { activity: "d3RqzIKzhqX82OwP", effect: "rGEvj6OHUjHan8pq" } },
  "riposte": { triggers: [{ on: "isMissed", if: { "activity.isMelee": true }, do: [{ type: "use", target: "source", activity: "QhxT9ZuZXmHGlrnT", weapon: true }] }] },
  // §90: the rest of the maneuvers. Precision Attack — "when you miss with an attack roll, add the die, which can turn it into a
  // hit": offered on the missed attack, before the verdict, like the Rogue's Luck is on a save.
  "precision-attack": { rollBonus: { activity: "WrckriM4bPU6NS38", on: ["attack"] } },
  // Ambush, Commanding Presence, Tactical Assessment: the die added to a check with these skills (or to Initiative), offered
  // as soon as the roll is made. "Without suffering the Incapacitated condition" (Ambush): left to the GM.
  "ambush": { rollBonus: { activity: "HiargkiZgN4q8kg6", on: ["check", "initiative"], skills: ["ste"] } },
  "commanding-presence": { rollBonus: { activity: "WYWuaoPWf2Vy5olB", on: ["check"], skills: ["itm", "prf", "per"] } },
  "tactical-assessment": { rollBonus: { activity: "qx70O22QGfH0MryE", on: ["check"], skills: ["his", "inv", "ins"] } },
  // Sweeping Attack: after a melee hit, the die (of the hit's type) to another creature within 1.50 m of the target and within
  // reach, if the roll would have hit it — the "damage" activity pays and gives the die.
  "sweeping-attack": { sweep: { activity: "P9XWzKIH1sEvsOtC" } },
  // Bait and Switch: swap places with a willing creature within 1.50 m (1.50 m of movement, no Opportunity Attack), then
  // the die added to the AC of one or the other until the start of the next turn — the data carries one effect per die value
  // (12): the first serves as a model, the total written into it.
  "bait-and-switch": { swapPlaces: { activity: "nYe2l7Rml0qyFbf6" }, rolledAc: { activity: "nYe2l7Rml0qyFbf6", effect: "8HUDgkIN8xvG2BAm", to: "choose" } },
  // Commander's Strike: one attack of the Attack action ceded to an ally, who attacks right away with a weapon as a Reaction,
  // the die added to the damage if it hits. The "damage" activity does not hurt the ally it targets.
  "commanders-strike": { replacesAttack: true, noDamage: ["spcp6PQ8947Ds4Qg"], commandStrike: { activity: "spcp6PQ8947Ds4Qg" } }
});
