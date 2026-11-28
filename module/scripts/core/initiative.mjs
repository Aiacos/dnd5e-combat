/**
 * §120: rerolling a too-low Initiative d20 (key `rerollInitiative`, Survivor — Hypervigilance: "when you roll
 * Initiative, you can reroll the d20 if it shows 9 or lower; you keep the new roll"). Pure functions, no Foundry.
 */

/**
 * Should it be rerolled, and what? The d20 of the roll (with Advantage or Disadvantage, the one that is kept) at `atMost` or
 * lower: the d20 of the whole roll is rerolled (same dice, same keep), and the Initiative changes by the difference.
 * @param {{atMost: number}} rule
 * @param {{number: number, kept: number, keep?: string|null}} d20   `kept`: the kept value; `keep`: "kh" / "kl" or nothing.
 * @returns {string|null}  The formula to reroll, or null.
 */
export function initiativeReroll(rule, d20) {
  if ( !rule || !d20 || !Number.isFinite(d20.kept) || (d20.kept > rule.atMost) ) return null;
  const n = Math.max(1, d20.number || 1);
  return `${n}d20${(n > 1) && d20.keep ? d20.keep : ""}`;
}

/** The new Initiative: the old one, minus the old d20, plus the new (bonus, tiebreaker and added dice kept). */
export const rerolledInitiative = (initiative, oldD20, newD20) => initiative - oldD20 + newD20;
