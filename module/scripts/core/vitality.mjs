/**
 * Improved Blessed Strikes (Cleric 14, SRD 5.2), Potent Spellcasting: "when you cast a cleric cantrip and deal
 * damage to a creature with it, you can bestow vitality on yourself or on another creature within 18 m:
 * it gains a number of Temporary Hit Points equal to twice your Wisdom modifier". Pure functions.
 */

/**
 * Does the rule apply to this cast? A cantrip of the class, damage dealt to at least one creature, and the chosen option
 * (one of the `requires` identifiers on the sheet, if any).
 * @param {{class: string, requires?: string[]}} rule
 * @param {{cantripOfClass: boolean, damaged: number, features: Iterable<string>}} cast
 */
export function vitalityApplies(rule, { cantripOfClass, damaged, features }) {
  if ( !rule || !cantripOfClass || !(damaged > 0) ) return false;
  const has = new Set(features ?? []);
  return !rule.requires?.length || rule.requires.some(id => has.has(id));
}

/**
 * Who can receive the vitality: the caster first, then the creatures on its side within range, from the nearest to the
 * farthest, `limit` at most (the window stays readable).
 * @param {Array<{id: string, name: string, distance: number, ally: boolean, self?: boolean}>} tokens
 * @param {number} range   in the unit of the distances given
 * @param {number} [limit]
 */
export function vitalityRecipients(tokens, range, limit=8) {
  const self = (tokens ?? []).filter(t => t.self);
  const allies = (tokens ?? []).filter(t => !t.self && t.ally && (t.distance <= range)).sort((a, b) => a.distance - b.distance);
  return [...self, ...allies].slice(0, limit);
}

/** Temporary Hit Points do not stack: the value only counts if it exceeds what the creature already has. */
export function vitalityGain(amount, current) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  return (value > (Number(current) || 0)) ? value : 0;
}
