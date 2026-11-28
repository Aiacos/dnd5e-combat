/**
 * Exclusive effects shipped with the module (SPEC §7, `choice` step): the activity carries several
 * effects of which the rule applies only ONE, at the author's choice. The engine asks the author for it
 * (adapter/choices.mjs) before applying, instead of placing everything as a utility plan does.
 * An item can declare its own in `flags["dnd5e-combat"].choice`.
 *
 *   { effects: "one", prompt?: <text> }   — `prompt`: question shown, otherwise the generic question.
 *
 * Identifiers verified in packs/_source/spells24 of dnd5e 6.0.3 (`system.identifier`).
 */

export const CHOICES = Object.freeze({
  // K3 (§324): the Aboleth's "Mind Domination" (MM 2024) — the "Dominated" effect (Charmed) is linked to no activity in the
  // data: the failed save placed nothing. Linked to the save activity, with no choice.
  "dominate-mind": { pool: { zdXAMnjaOcsVmLZP: ["85n0EJTGfngNSLLl"] } },
  // A chosen ability: six "Hexed <ability>" effects on the Place Curse activity.
  "hex": { effects: "one" },
  // C12-f: "Elemental Embodiment", "Damage Resistance" — one Resistance of choice among five.
  "elemental-epitome": { effects: "one" },
  // 2024 Unarmed Strike, failed save: Grapple (Grappled) OR Shove (Prone, or pushed 1.50 m).
  // The Barbarian's and Monk's item (classes24, same identifier) has only the first two.
  "unarmed-strike": { effects: "one" },
  // Fire Shield: "the shield is warm or cold, your choice" — two effects on the utility activity (warm:
  // cold Resistance, fire retaliation; cold: the reverse). Without a choice, the plan would place both (§16.9).
  "fire-shield": { effects: "one" },
  // §53: Potion of Resistance — "Resistance to one damage type" (the GM chooses or rolls): ten effects, only one placed.
  "potion-of-resistance": { effects: "one" },
  // Resistance (§16.46): "by choosing a damage type" — eleven "Protection: …" effects on the activity; without a choice, the
  // plan would place them all (the target would resist everything).
  "resistance": { effects: "one" },
  // §16.47: Guidance — "choose a skill"; dnd5e places its 18 effects (one per skill) at once.
  "guidance": { effects: "one" },
  // §19: Blindness/Deafness — "Blinded or Deafened (your choice)"; Eyebite — "one of the following effects, your choice".
  "blindness-deafness": { effects: "one" },
  "eyebite": { effects: "one" },
  // Audit of the PHB spell compendium (on 2026-09-27): activities with several effects of which the rule gives only one.
  // Enhance Ability — "choose an ability" (five effects, one per ability except Con).
  // §401: "you can choose a different ability for each target".
  "enhance-ability": { effects: "one", perTarget: true },
  // Enlarge/Reduce — "the target is enlarged or reduced, your choice".
  "enlarge-reduce": { effects: "one" },
  // Protection from Energy — "Resistance to one damage type of your choice" (acid, cold, fire, lightning, thunder).
  "protection-from-energy": { effects: "one" },
  // Calm Emotions — "choose one of the two effects" (Calmed, Indifference).
  // §401: "choose one of the following effects" for each creature that fails.
  "calm-emotions": { effects: "one", perTarget: true },
  // Contagion — "choose an ability" (six Infected effects).
  "contagion": { effects: "one" },
  // §295: Bewitching Magic (College of Lore) — "Charmed or Frightened (your choice)"; Imprisonment — "one of the following
  // effects".
  "beguiling-magic": { effects: "one" },
  "imprisonment": { effects: "one" }
});
