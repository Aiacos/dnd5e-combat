/**
 * Search (Search, SPEC §16.49, 2024 rules) against Hidden creatures: a Wisdom (Perception) check against the DC of
 * each hiding place (the Stealth total, carried by the Stealth effect). Here: the verdicts, without Foundry.
 *
 * Per candidate, in order:
 *  - `sensed`: the observer already perceives it despite the Invisible condition (Blindsight, Truesight…) → found, no roll;
 *  - `seeable` false: out of sight (wall, floor, fog, Darkness it cannot pierce — heavily obscured area for it) →
 *    not found, whatever the roll;
 *  - otherwise the roll; `disadvantage`: the hiding place is in a lightly obscured area for it (perceived light dim,
 *    core/illumination.mjs).
 *
 * A single check for the action. If only one hiding place is in Dim Light, the check is rolled with Disadvantage and, for
 * the hiding places in full light, the FIRST d20 is kept: that is exactly the check without Disadvantage.
 */

/**
 * The check's mode: Disadvantage if a hiding place to be judged by the roll is in a lightly obscured area.
 * @param {Array<{sensed?: boolean, seeable?: boolean, disadvantage?: boolean}>} candidates
 * @returns {"normal"|"disadvantage"}
 */
export function searchRollMode(candidates) {
  return candidates.some(c => !c.sensed && c.seeable && c.disadvantage) ? "disadvantage" : "normal";
}

/**
 * What traits and items add to the check (key `searchBonus`): the dice, and the item that gives Advantage. Equipment
 * that is not worn — or not attuned when it requires it — adds nothing; the Advantage of an item with uses requires that one
 * be left.
 * @param {Array<{rule: {formula?: string, advantage?: true}|null, counts: boolean, usesMax?: number, usesLeft?: number}>} sources
 * @returns {{parts: string[], keen: object|null}}  `keen`: the source retained for the Advantage (as passed)
 */
export function searchBonuses(sources) {
  const active = (sources ?? []).filter(s => s.rule && s.counts);
  return { parts: active.map(s => s.rule.formula).filter(Boolean),
    keen: active.find(s => s.rule.advantage && (!Number(s.usesMax) || (Number(s.usesLeft) > 0))) ?? null };
}

/**
 * The total without Disadvantage drawn from a check rolled with it: the total, minus the kept d20, plus the first d20.
 * @param {{total: number, d20: number[], kept: number|null}} roll   `d20`: the d20 rolled, in order (rerolls excluded);
 *                                                                  `kept`: the one that counts in `total`.
 * @returns {number}
 */
export function normalTotal({ total, d20=[], kept=null }) {
  if ( (d20.length < 2) || !Number.isFinite(kept) ) return total;
  return total - kept + d20[0];
}

/**
 * The verdicts.
 * @param {Array<{id: string, dc: number, sensed?: boolean, seeable?: boolean, disadvantage?: boolean}>} candidates
 * @param {{total: number, d20?: number[], kept?: number|null}} roll   The check as rolled (mode of `searchRollMode`).
 * @returns {Array<{id: string, found: boolean, reason: "senses"|"unseen"|"roll", total?: number, dc: number}>}
 */
export function searchVerdicts(candidates, roll) {
  const withDisadvantage = roll.total;
  const without = normalTotal(roll);
  return candidates.map(c => {
    if ( c.sensed ) return { id: c.id, found: true, reason: "senses", dc: c.dc };
    if ( !c.seeable ) return { id: c.id, found: false, reason: "unseen", dc: c.dc };
    const total = c.disadvantage ? withDisadvantage : without;
    return { id: c.id, found: total >= c.dc, reason: "roll", total, dc: c.dc };
  });
}

/** Disadvantage on a passive value: −5 (2024 rules, PHB glossary). */
export const PASSIVE_DISADVANTAGE = 5;

/**
 * Passive Perception (SPEC §16.51): does the observer notice the Hidden creature without searching for it? Perceived by its
 * senses → yes; out of sight → no; otherwise its Passive Perception, −5 if the hiding place is in a lightly obscured area for
 * it, against the DC of the hiding place.
 * @param {{passive: number, sensed?: boolean, seeable?: boolean, disadvantage?: boolean}} observer
 * @param {number} dc
 * @returns {{notices: boolean, score: number|null}}  `score`: the value compared to the DC (null without a comparison).
 */
export function passiveNotice({ passive, sensed=false, seeable=false, disadvantage=false }, dc) {
  if ( sensed ) return { notices: true, score: null };
  if ( !seeable || !Number.isFinite(passive) ) return { notices: false, score: null };
  const score = passive - (disadvantage ? PASSIVE_DISADVANTAGE : 0);
  return { notices: score >= dc, score };
}
