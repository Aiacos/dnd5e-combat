/**
 * §148: should an added die be offered after the roll (Bardic Inspiration)? What can be computed without Foundry.
 *
 * Pure functions, no dependency on Foundry.
 */

/**
 * "When the creature fails a D20 Test, it can roll the die and add it." With no known threshold (free check), the question
 * is always asked ("Failed?"); with a threshold: nothing on a success, nothing either when even the die's highest result
 * would not be enough (the die is not wasted).
 * @param {{total: number, needed: number|null, max: number|null}} c  `max`: the die's highest result (6 for 1d6).
 * @returns {"offer"|"success"|"hopeless"}
 */
export function inspirationOffer({ total, needed, max }) {
  if ( !Number.isFinite(needed) ) return "offer";
  if ( total >= needed ) return "success";
  if ( Number.isFinite(max) && (total + max < needed) ) return "hopeless";
  return "offer";
}
