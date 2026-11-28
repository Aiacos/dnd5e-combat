/**
 * Rogue's Sneak Attack and Cunning Strikes (SPEC §20, Player's Handbook 2024). Pure functions.
 *
 * Sneak Attack: at most once per turn, extra damage dice (of the weapon's type) on a hit made with a Finesse or ranged
 * weapon, under two possible conditions: the attack has Advantage, or an ally who is not Incapacitated is within
 * 5 feet of the target and the attack does not have Disadvantage.
 *
 * Cunning Strike (level 5): when the Sneak Attack damage is dealt, the Rogue can forgo some of its dice to
 * add an effect, each effect having its price in dice. Two effects at level 11
 * (Improved Cunning Strike), three more at level 14 (Devious Strikes).
 */

/** The advantage mode of a dnd5e roll (`advantageMode`): 1 Advantage, -1 Disadvantage, 0 neither. */
export const ADVANTAGE = 1;
export const DISADVANTAGE = -1;

/**
 * Why Sneak Attack does not apply, or null if it applies.
 * @param {object} attack
 * @param {boolean} attack.weapon          The attack is made with a weapon (not a spell, not an unarmed attack).
 * @param {boolean} attack.finesse         The weapon has the Finesse property.
 * @param {boolean} attack.rangedWeapon    It is a ranged weapon (not a thrown melee weapon).
 * @param {number} attack.advantageMode    The attack roll's mode, once Advantage and Disadvantage are combined.
 * @param {boolean} attack.allyNear        An ally of the attacker, not Incapacitated, within 5 feet of the target.
 * @param {boolean} [attack.spent]         Sneak Attack has already been used this turn.
 * @param {boolean} [attack.anyWeapon]     §72: any weapon will do (an NPC's Sneak Attack).
 * @param {boolean} [attack.freeTarget]    §72: the target is of a type against which nothing is required ("if the target is an
 *   Undead").
 * @returns {"spent"|"notWeapon"|"weaponKind"|"disadvantage"|"noAdvantage"|null}
 */
export function sneakAttackIssue({ weapon, finesse, rangedWeapon, advantageMode, allyNear, spent=false, anyWeapon=false, freeTarget=false }) {
  if ( spent ) return "spent";
  if ( !weapon ) return "notWeapon";
  if ( !anyWeapon && !finesse && !rangedWeapon ) return "weaponKind";
  if ( freeTarget ) return null;
  if ( advantageMode === ADVANTAGE ) return null;
  if ( advantageMode === DISADVANTAGE ) return "disadvantage";
  return allyNear ? null : "noAdvantage";
}

/**
 * The number of dice and their size in a Sneak Attack formula ("3d6"), or null if it does not read that way.
 * @param {string} formula
 * @returns {{number: number, faces: number}|null}
 */
export function parseDice(formula) {
  const m = String(formula ?? "").replace(/\s+/g, "").match(/^(\d+)d(\d+)$/i);
  return m ? { number: Number(m[1]), faces: Number(m[2]) } : null;
}

/** The Sneak Attack dice of a Rogue of this level (Rogue table: 1d6 at level 1, +1d6 every two levels). */
export function sneakDiceAtLevel(level) {
  const n = Math.ceil((Number(level) || 0) / 2);
  return n > 0 ? { number: n, faces: 6 } : null;
}

/**
 * The Cunning Strikes that can be offered: each costs `cost` dice, and at least the cost must be kept.
 * @param {Array<{key: string, cost: number, available?: boolean}>} options   `available: false`: a condition is missing (poisoner's
 *                                                                              kit, size of the target).
 * @param {number} dice
 * @returns {Array<{key: string, cost: number}>}
 */
export function affordableStrikes(options, dice) {
  return (options ?? []).filter(o => (o.available !== false) && (o.cost > 0) && (o.cost <= dice));
}

/**
 * The author's choice, put back into the rules: each effect at most once, no more than `max` effects, and a total cost that
 * fits in the dice. What exceeds is dropped, in the order of the choice.
 * @param {string[]} chosen
 * @param {Array<{key: string, cost: number}>} options   Those that could be chosen (affordableStrikes).
 * @param {{dice: number, max: number}} limits
 * @returns {{strikes: string[], cost: number, dice: number}}  `dice`: those left to roll.
 */
export function settleStrikes(chosen, options, { dice, max }) {
  const byKey = new Map((options ?? []).map(o => [o.key, o]));
  const strikes = [];
  let cost = 0;
  for ( const key of chosen ?? [] ) {
    const option = byKey.get(key);
    if ( !option || strikes.includes(key) || (strikes.length >= max) || ((cost + option.cost) > dice) ) continue;
    strikes.push(key);
    cost += option.cost;
  }
  return { strikes, cost, dice: dice - cost };
}

/**
 * Assassinate (Assassin, level 3): in the first round of a combat, Advantage against any creature that has not yet acted.
 * A creature has taken its turn in the first round if it comes before the
 * combatant whose turn it is (Initiative order); the one whose turn it is is taking it.
 * @param {{round: number, turn: number, targetTurn: number|null}} combat   `targetTurn`: rank of the target in the
 *                                                                           combat order, null if it is not in it.
 */
export function hasNotActedYet({ round, turn, targetTurn }) {
  if ( round !== 1 ) return false;
  if ( !Number.isInteger(targetTurn) ) return true;   // outside the combat (surprise, late arrival): it has not acted
  return targetTurn > turn;
}
