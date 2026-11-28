/**
 * §258: generic endings (`endsWhen`, core/endings.mjs), by dnd5e identifier — found by the CAT / CPR audit of 2026-10-28.
 */

const NOBODY = { unaffected: "failedSave" };

/** §265: the "Banished" effects that carry their bearer to a demiplane (PHB 2.2.0). */
export const BANISHES = Object.freeze({
  "banishment": ["nwne4bDtD4pSWWPM"],
  "banishing-smite": ["dAnHnTaGvsiN1WzK"]
});

/** §268: "the target can't be Charmed, Frightened or possessed by them" (Protection from Evil and Good). */
export const WARDS_CONDITIONS = Object.freeze({
  "protection-from-evil-and-good": { types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"], statuses: ["charmed", "frightened"] },
  // Magic Circle (SRD 5.2): "targets within the Cylinder can't be […] Charmed or Frightened by the
  // creature".
  "magic-circle": { types: ["celestial", "elemental", "fey", "fiend", "undead"], statuses: ["charmed", "frightened"] }
});

export const ENDS_WHEN = Object.freeze({
  // "The spell ends early if the target dons armor."
  "mage-armor": { armor: "any" },
  // Rage (PHB 2024): "it ends early if you don Heavy armor".
  "rage": { armor: "heavy" },
  // Warding Bond (SRD 5.2): "The spell ends if you drop to 0 Hit Points or if you and the target become separated by more than
  // 60 feet" — the caster only: a warded creature at 0 HP stays warded (issue #150).
  "warding-bond": { apart: { distance: 60, units: "ft" }, zeroHp: "caster", spell: true },
  // Compelled Duel: "the spell ends if you make an attack roll against a creature other than the target, if you cast a spell
  // on an enemy other than the target, if an ally of yours deals damage to the target, or if you end your turn more than 9 m
  // from it" (§270 for the first three).
  "compelled-duel": { apart: { distance: 30, units: "ft", at: "casterTurnEnd" }, casterTargetsOther: true, allyDamages: true, spell: true, ...NOBODY },
  // Concentration spells that have an effect only on a failed save: if all the targets succeed, the Concentration has
  // nothing left to hold (setting `endUnaffected`).
  "banishment": NOBODY,
  "bestow-curse": NOBODY,
  "compulsion": NOBODY,
  "confusion": NOBODY,
  "crown-of-madness": NOBODY,
  "dominate-beast": NOBODY,
  "dominate-person": NOBODY,
  "dominate-monster": NOBODY,
  "enlarge-reduce": NOBODY,
  "fear": NOBODY,
  "hideous-laughter": NOBODY,
  "tashas-hideous-laughter": NOBODY,
  "hold-monster": NOBODY,
  "hold-person": NOBODY,
  "hypnotic-pattern": NOBODY,
  "phantasmal-killer": NOBODY,
  "polymorph": NOBODY,
  "slow": NOBODY,
  "sleep": NOBODY
});
