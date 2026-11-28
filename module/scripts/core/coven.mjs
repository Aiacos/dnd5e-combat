/**
 * Covens (SPEC §19.5): creatures that share one pool of Hit Points — any damage taken by one of the members
 * is removed from the shared pool, and damage from one source taken by several members counts as many times. Each
 * member keeps its HP, held equal: the DIFFERENCE taken by one is carried over to the others — two simultaneous hits count
 * twice, without one write erasing the other.
 *
 * Pure functions, no dependency on Foundry.
 */

/**
 * A member's HP after the difference taken by another, clamped to [0, max]. null: nothing to write (already at 0 under damage,
 * or value unchanged).
 * @param {{value: number, max: number}} hp  The member's HP.
 * @param {number} delta                     The difference taken by the other (negative: damage).
 */
export function sharedValue(hp, delta) {
  if ( !Number.isFinite(delta) || (delta === 0) || !hp ) return null;
  if ( (delta < 0) && (hp.value <= 0) ) return null;
  const next = Math.max(0, Math.min(hp.max ?? Infinity, hp.value + delta));
  return (next === hp.value) ? null : next;
}
