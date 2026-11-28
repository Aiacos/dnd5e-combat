/**
 * Hit chance (SPEC §15.3, BG3 style): the probability that an attack roll hits an AC,
 * with dnd5e's d20 rules — a natural 1 always misses, a natural roll at or above the critical threshold
 * always hits (and is a Critical Hit), Advantage and Disadvantage cancel out. The bonus may
 * carry dice (Bless: +1d4), whose exact distribution is computed. Pure functions, no
 * dependency on Foundry.
 */

/**
 * Distribution of the natural d20 by mode: probability of each face 1..20 (index 0 unused).
 * @param {1|0|-1} mode  1: Advantage (the higher of two), -1: Disadvantage (the lower).
 * @returns {number[]}
 */
export function d20Law(mode=0) {
  const law = [0];
  for ( let n = 1; n <= 20; n++ ) {
    if ( mode === 1 ) law.push(((n * n) - ((n - 1) * (n - 1))) / 400);
    else if ( mode === -1 ) law.push((((21 - n) * (21 - n)) - ((20 - n) * (20 - n))) / 400);
    else law.push(1 / 20);
  }
  return law;
}

/**
 * Distribution of the sum of a fixed bonus and dice: Map value → probability.
 * @param {number} flat
 * @param {Array<{number: number, faces: number, sign?: 1|-1}>} dice
 * @returns {Map<number, number>}
 */
export function bonusLaw(flat=0, dice=[]) {
  let law = new Map([[flat, 1]]);
  for ( const { number, faces, sign=1 } of dice ) {
    for ( let k = 0; k < number; k++ ) {
      const next = new Map();
      for ( const [value, p] of law ) {
        for ( let f = 1; f <= faces; f++ ) {
          const v = value + (sign * f);
          next.set(v, (next.get(v) ?? 0) + (p / faces));
        }
      }
      law = next;
    }
  }
  return law;
}

/**
 * Chance to hit an AC.
 * @param {object} attack
 * @param {number|null} attack.ac                 AC to beat (Cover included); null: untouchable (Total Cover).
 * @param {number} [attack.bonus]                 Fixed part of the attack bonus.
 * @param {Array<{number: number, faces: number, sign?: 1|-1}>} [attack.dice]  Dice of the bonus.
 * @param {1|0|-1} [attack.mode]                  Advantage, normal roll, Disadvantage.
 * @param {number} [attack.critical]              Critical threshold (20 by default).
 * @param {boolean} [attack.autoCritical]         Every hit is a Critical Hit (Paralyzed, Unconscious in melee).
 * @param {number} [attack.margin]                §207: a hit whose total reaches AC + `margin` is a Critical Hit (0: no).
 * @returns {{hit: number, critical: number}}     Probabilities between 0 and 1; `critical` is included in `hit`.
 */
export function hitChance({ ac, bonus=0, dice=[], mode=0, critical=20, autoCritical=false, margin=0 }) {
  if ( (ac === null) || (ac === undefined) ) return { hit: 0, critical: 0 };
  const d20 = d20Law(mode);
  const extra = Array.from(bonusLaw(bonus, dice));
  const threshold = Math.min(Math.max(critical, 2), 20);
  let hit = 0;
  let crit = 0;
  for ( let n = 1; n <= 20; n++ ) {
    const p = d20[n];
    if ( n === 1 ) continue;
    // A natural 20 always hits; a lowered threshold (19) is a Critical Hit only if the total reaches the AC (core/attack.mjs).
    if ( n === 20 ) { hit += p; crit += p; continue; }
    for ( const [value, q] of extra ) {
      if ( n + value < ac ) continue;
      hit += p * q;
      if ( (n >= threshold) || ((margin > 0) && (n + value >= ac + margin)) ) crit += p * q;
    }
  }
  if ( autoCritical ) crit = hit;
  return { hit: clamp01(hit), critical: clamp01(crit) };
}

const clamp01 = x => Math.min(1, Math.max(0, x));

/**
 * Chance that a saving throw fails (§15.3, debt settled on 2026-09-27): d20 + bonus < DC. No automatic success or failure
 * on the natural die for a saving throw (2024 rules: only the attack roll has its 1 and its 20); a condition can
 * make it fail automatically (Paralyzed on Strength or Dexterity), an Immunity make it moot.
 * @param {object} save
 * @param {number} save.dc
 * @param {number} [save.bonus]                   Fixed part of the saving throw bonus.
 * @param {Array<{number: number, faces: number, sign?: 1|-1}>} [save.dice]  Dice of the bonus (Bless, Bane).
 * @param {1|0|-1} [save.mode]
 * @param {boolean} [save.autoFail]
 * @param {boolean} [save.immune]
 * @returns {number}  Probability of failure, between 0 and 1.
 */
export function saveFailChance({ dc, bonus=0, dice=[], mode=0, autoFail=false, immune=false }) {
  if ( immune ) return 0;
  if ( autoFail ) return 1;
  const d20 = d20Law(mode);
  const extra = Array.from(bonusLaw(bonus, dice));
  let fail = 0;
  for ( let n = 1; n <= 20; n++ ) {
    for ( const [value, q] of extra ) if ( n + value < dc ) fail += d20[n] * q;
  }
  return clamp01(fail);
}

/** Whole percentage to display: never 0 or 100 as long as the result is not certain. */
export function asPercent(p) {
  if ( p <= 0 ) return 0;
  if ( p >= 1 ) return 100;
  return Math.min(99, Math.max(1, Math.round(p * 100)));
}

/** What players can see of the badge (`hitChancePlayers` setting); the GM sees everything ("full"). */
export const HIT_CHANCE_LEVELS = Object.freeze(["full", "percent", "advantage", "off"]);

/**
 * What a level shows of an attack: the percentage (and the Critical Hit), the target's AC, the reasons for Advantage and
 * Disadvantage. "advantage" (#247): the reasons alone — the player knows their roll will have Advantage, and why, without
 * learning anything of the target's defense. An unknown level shows nothing.
 * @param {string} level
 * @returns {{percent: boolean, ac: boolean, reasons: boolean}}
 */
export function hitChanceShows(level) {
  return { percent: (level === "full") || (level === "percent"), ac: level === "full",
    reasons: (level === "full") || (level === "percent") || (level === "advantage") };
}

