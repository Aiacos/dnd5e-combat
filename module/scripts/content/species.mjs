/**
 * The species of the 2024 Player's Handbook (SPEC §31), premium module `dnd-players-handbook` 2.2.0 (`origins` pack, traits
 * `phbspt…`). Already there: Fey Ancestry (§16.25), Swarm Leap (§16.10, content/teleports.mjs).
 *
 * What dnd5e already does by itself, through the traits' transferred effects or the "Special Traits" cells of the sheet:
 * Gnomish Cunning (Advantage on Int., Wis., Cha. saves), Luck (reroll a 1, `halflingLucky`), Halfling Nimbleness, Powerful Build,
 * Dwarven Toughness, Dwarven Resilience (poison Resistance), Celestial Resistance, Draconic Flight, Healing Hands, Trance. An
 * old copy of a trait may have lost its effect: the macro `tools/macros/reparer-effets-phb.js` copies them back from the
 * compendium.
 */

/** Giant Ancestry (Goliath): the boons offered on a hit, one use each. */
export const SPECIES = Object.freeze({
  // Brave (Halfling): "Advantage on saving throws to avoid or end the Frightened condition".
  // Halfling, Naturally Stealthy (SRD 5.2): "you can take the Hide action even when you are obscured only by a
  // creature at least one size larger than you" (core/hide-screen.mjs).
  "naturally-stealthy": { hidesBehindLarger: true },
  "brave": { saveAdvantage: ["frightened"] },
  // Dwarven Resilience: "Advantage on saving throws to avoid the Poisoned condition".
  "dwarven-resilience": { saveAdvantage: ["poisoned"] },
  // Relentless Endurance (Orc): "if you drop to 0 Hit Points without being killed outright, you can drop to 1 Hit Point instead".
  "relentless-endurance": { endurance: true },
  // Adrenaline Rush (Orc): "the Dash action as a Bonus Action" (the Temporary Hit Points: dnd5e's activity).
  "adrenaline-rush": { basicActions: { jN5Zo6mDXll3c4Cz: "dash" } },
  // Breath Weapon (Dragonborn): "you can replace one of your attacks with an exhalation" — the two activities (Cone, Line).
  "breath-weapon": { replacesAttack: true },
  // Large Form (Goliath 5): "become Large" — the activity's effect changes the size (§16.49, `resize`).
  "large-form": { resize: { QI7POclNlvX9a8VD: 1 } },
  // Giant Ancestry (Goliath) — Fire's Burn: "1d10 extra fire damage"; Frost's Chill: "1d6 cold damage, and its
  // Speed reduced by 3 m until the start of your next turn"; Hill's Tumble: "Prone, Large or smaller".
  "fires-burn": { hitRider: { damage: "002cv19dj8WGzSl2" } },
  "frosts-chill": { hitRider: { damage: "6goWQaWLexUqgig8", effect: "YHKgdj2KIbQRBZWW" }, effectEnds: { YHKgdj2KIbQRBZWW: "casterTurnStart" } },
  "hills-tumble": { hitRider: { status: "prone", sizeAtMost: "lg" } },
  // Stone's Endurance: "when you take damage, your Reaction: 1d12 + your Constitution modifier less"
  // — the activity's roll, which already carries Constitution ("1d12 + @abilities.con.mod": §295, it was counted twice); the
  // engine offers it when an attack hits you.
  "stones-endurance": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "vrWhAQ6Bj4gznxHq" }, { type: "reduce" }] }] },
  // Sky's Thunder: "when you take damage from a creature within 18 m, your Reaction: 1d8
  // thunder damage to that creature".
  "storms-thunder": { triggers: [{ on: "isDamaged", if: { "target.within": { distance: 60, units: "ft" } },
    do: [{ type: "use", activity: "3eWfDnXfYJVJqT1z", target: "source" }] }] },
  // Celestial Revelation (Aasimar 3): during the transformation, once per aasimar turn, a target of its attack or its
  // spell takes extra damage equal to its proficiency bonus — radiant (necrotic for
  // the Necrotic Shroud: left to the player).
  // §299: Draconic Flight — "the effect ends if you have the Incapacitated condition".
  "draconic-flight": { endsWhen: { incapacitated: "bearer" } },
  "celestial-revelation": { triggers: [{ on: "preDamageRoll", oncePerTurn: true,
    if: { "source.hasEffect": "celestial-revelation", any: [{ "activity.isAttack": true }, { "activity.isSpell": true }] },
    do: [{ type: "damage", formula: "@prof", damageType: "radiant" }] }],
    // §295: Necrotic Shroud — "Frightened until the end of your next turn" (the data: one minute).
    effectEnds: { "33dHubd4zYAkSAbE": "casterTurnEnd" } }
});
