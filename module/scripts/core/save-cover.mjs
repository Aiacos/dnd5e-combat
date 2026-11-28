/**
 * Cover and Dexterity saving throws (issue #183) — SRD 5.2, "Cover": "Half Cover (+2 bonus to AC and Dexterity saving
 * throws), Three-Quarters Cover (+5 bonus to AC and Dexterity saving throws)". Pure functions.
 * Scope: a saving throw that targets its target, without an area — Cover is then judged from the author, as for an attack. An
 * area would be judged from its point of origin: left to the GM. `saveIgnoresCover`: "the target gets no benefit from Half Cover or
 * Three-Quarters Cover for this saving throw" (Sacred Flame).
 */

/** Does this saving throw receive the Cover bonus? */
export function dexSaveTakesCover({ ability, area=false, ignores=false }) {
  return (ability === "dex") && !area && !ignores;
}

/** The bonus Cover gives to the saving throw: 2, 5, or 0 (no Cover; Total Cover has no bonus — the target is not targetable). */
export function coverSaveBonus(cover) {
  return Number.isFinite(cover?.bonus) && (cover.bonus > 0) ? cover.bonus : 0;
}
