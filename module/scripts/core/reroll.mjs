/**
 * The reroll of a missed roll that an activity pays for (`rollBonus.reroll` with `activity`, §280): its formula. Pure function.
 * @param {{bonus?: string, advantage?: true, sets?: number}|null} reroll  `advantage` — the new roll has Advantage
 *   (Counterspell-like): two d20, the best kept; `sets` — nothing is rerolled, the d20 takes this value (Lucky Strike:
 *   "the roll becomes a 20").
 * @returns {string}
 */
export function rerollFormula(reroll) {
  const die = Number.isInteger(reroll?.sets) ? String(reroll.sets) : (reroll?.advantage === true) ? "2d20kh" : "1d20";
  const bonus = String(reroll?.bonus ?? "").trim();
  return (bonus && (bonus !== "0")) ? `${die} + ${bonus}` : die;
}

/**
 * Is this reroll offered? A missed roll against a known DC; and, for a fixed d20 (`sets`), also a check whose DC the engine
 * does not know (up to the player to judge, "after seeing it") — never when the d20 already equals that much. Pure function.
 * @param {{sets?: number}|null} reroll
 * @param {{d20: number|null, total: number, needed: number|null}} roll
 */
export function rerollOffered(reroll, { d20, total, needed }) {
  if ( !Number.isInteger(d20) ) return false;
  const fixed = Number.isInteger(reroll?.sets);
  if ( fixed && (d20 >= reroll.sets) ) return false;
  return Number.isFinite(needed) ? (total < needed) : fixed;
}

/** The question of this reroll (key under `DND5ECOMBAT.Relance.`). Pure function. */
export function rerollQuestion(reroll, needed) {
  if ( Number.isInteger(reroll?.sets) ) return Number.isFinite(needed) ? "QuestionFixe" : "QuestionFixeTest";
  return (reroll?.advantage === true) ? "QuestionAvantage" : "QuestionPayee";
}
