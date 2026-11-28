/**
 * GitHub issue #32: "Success at a Cost", optional aid from the 2024 Dungeon Master's Guide (chapter 2). When a d20 test fails by
 * 1 or 2, the GM can offer success along with a complication the GM describes; the player accepts or refuses. Nothing is
 * decided here: the calculation of what can be offered, without Foundry.
 *
 * Rules kept:
 *  - a failure by 1 to `margin` (2) below the threshold, threshold known (AC, DC);
 *  - an attack on a natural 1 (automatic miss) or against Total Cover is never offered; a hit obtained at a cost is
 *    never a Critical Hit;
 *  - a roll without a known threshold cannot "miss by 1 or 2": nothing.
 */

/** The maximum margin of the aid ("by 1 or 2"). */
export const AT_COST_MARGIN = 2;

/** The bounded pause durations (seconds): 0 = no pause, only the card buttons. */
export const AT_COST_HOLD = Object.freeze({ min: 0, max: 30, byDefault: 5 });

/**
 * By how much the roll misses its threshold, when it is by 1 to `margin`; 0 otherwise (succeeded, missed by more, threshold
 * unknown).
 * @param {number} total
 * @param {number|null} needed
 * @param {number} [margin]
 */
export function nearMiss(total, needed, margin=AT_COST_MARGIN) {
  if ( !Number.isFinite(total) || !Number.isFinite(needed) || !(margin > 0) ) return 0;
  const by = needed - total;
  return ((by >= 1) && (by <= margin)) ? by : 0;
}

/**
 * The targets of a judged attack that a success at a cost would make hit: missed on the total (not a natural 1, not Total
 * Cover, not a Reaction that turns the hit into a miss without another roll), by 1 to `margin`, and affected.
 * @param {{total: number}} roll
 * @param {Array<{token: string, hit: boolean|null, reason: string|null, ac: number|null, unaffected?: any}>} targets
 * @param {number} margin  0: the aid is off for this roll.
 * @returns {Array<{token: string, by: number}>}
 */
export function nearMissTargets(roll, targets, margin) {
  if ( !(margin > 0) || !roll ) return [];
  return (targets ?? [])
    .filter(t => (t.hit === false) && (t.reason === "miss") && !t.unaffected)
    // §489: a target against whom the attacker had to reroll (Parry) is judged on the new roll.
    .map(t => ({ token: t.token, by: nearMiss((t.rerolled?.total ?? roll.total), t.ac, margin) }))
    .filter(t => t.by > 0);
}

/**
 * The aid's margin for a roll by this creature: 0 if the aid is off or if the creature is not a player character — the
 * rule targets players (the GM proposes, the player chooses; for an NPC, the GM decides alone: user decision, 2026-11-06).
 * `npc` stays here for a table that would want it one day; no setting provides it.
 * @param {{enabled: boolean, npc: boolean, isCharacter: boolean}} facts
 */
export function atCostMarginFor({ enabled, npc=false, isCharacter=false }) {
  if ( !enabled ) return 0;
  return (isCharacter || npc) ? AT_COST_MARGIN : 0;
}

/** The pause duration, bounded; an unreadable value takes the default one. */
export function holdSeconds(value) {
  const n = Number(value);
  if ( !Number.isFinite(n) ) return AT_COST_HOLD.byDefault;
  return Math.min(AT_COST_HOLD.max, Math.max(AT_COST_HOLD.min, Math.round(n)));
}

/** The cleaned price text: one line, 300 characters at most. Empty: null (the price is left to be said aloud). */
export function cleanCost(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, 300) : null;
}

/**
 * A group roll (§242) or a native roll with a DC: can the row become a success at a cost? Rolled (total known), not yet
 * changed, and missed by 1 to `margin`.
 * @param {{total: number|null, dc: number|null, atCost?: any}} row
 */
export function rowAtCost({ total, dc, atCost=null }, margin=AT_COST_MARGIN) {
  if ( atCost ) return 0;
  return nearMiss(total, dc, margin);
}
