/**
 * Spell defenses (SPEC §16.46), without Foundry.
 *  - Resistance (`damageShield`): "when the creature takes damage of the chosen type, it reduces the damage taken by 1d4;
 *    the same creature can benefit from this spell only once per turn".
 *  - Arcane Vigor (`hitDiceHeal`): one or two Hit Dice spent to heal, one more die per slot level
 *    above 2nd.
 * Pure functions.
 */

/**
 * Removes `amount` from the damage of type `type` (spread over its entries, in order), without going below zero.
 * @param {Array<{value: number, type: string}>} damages
 * @returns {{damages: Array<object>, reduced: number}}
 */
export function reduceDamageOfType(damages, type, amount) {
  let left = Math.max(0, Number(amount) || 0);
  let reduced = 0;
  const out = (damages ?? []).map(d => {
    if ( (d.type !== type) || (left <= 0) || !(d.value > 0) ) return d;
    const take = Math.min(left, d.value);
    left -= take;
    reduced += take;
    return { ...d, value: d.value - take };
  });
  return { damages: out, reduced };
}

/** How many Hit Dice Arcane Vigor rolls at this slot level (at most those that remain). */
export function hitDiceAllowed({ base, spellLevel, slotLevel, available }) {
  const allowed = base + Math.max(0, (Number(slotLevel) || spellLevel) - spellLevel);
  return Math.max(0, Math.min(allowed, Number(available) || 0));
}

/**
 * O8d (§347): Resistance to damage from a ranged attack with a weapon (Shield of Missile Attraction: "while you hold this shield,
 * you have Resistance to damage from attacks made with ranged weapons"). Each part whose type is not already resisted
 * or immune is halved, rounded down; healing and Temporary Hit Points remain.
 * @param {Array<{value: number, type: string}>} damages
 * @param {{resisted?: Iterable<string>, immune?: Iterable<string>}} traits
 * @returns {{damages: Array<object>, reduced: number}}
 */
export function halveUnresisted(damages, { resisted=[], immune=[] }={}) {
  const skip = new Set([...resisted, ...immune, "healing", "temphp"]);
  let reduced = 0;
  const out = (damages ?? []).map(d => {
    if ( skip.has(d.type) || !(d.value > 0) ) return d;
    const value = Math.floor(d.value / 2);
    reduced += d.value - value;
    return { ...d, value };
  });
  return { damages: out, reduced };
}

/**
 * O8d (§347): the bearer who takes the target's place (Shield of Missile Attraction: "when a ranged weapon attack targets a
 * creature within 3 m of you, the curse makes you the target") — the nearest among those in range (`within`).
 * @param {Array<{id: string, distance: number, within: boolean}>} bearers
 * @returns {string|null}
 */
export function attractorOf(bearers) {
  const near = (bearers ?? []).filter(b => b.within && Number.isFinite(b.distance)).sort((a, b) => a.distance - b.distance);
  return near[0]?.id ?? null;
}

/** §355: the creature types that a weapon does not feed on ("except a Construct or an Undead"). */
const SOULLESS = Object.freeze(["construct", "undead"]);

/**
 * §355: what an attack with the weapon brings its bearer — `devours` (Blackrazor: Temporary Hit Points equal to the max HP of
 * the creature it drops to 0, and the creature is killed); `critAmount` (Life Stealer: those Temporary Hit Points on a Critical
 * Hit). Temporary Hit Points do not stack: the highest value. Returns `{ tempHp, slain }` (ids of the slain victims).
 * @param {{devours?: boolean, critAmount?: number, victims: Array<{id: string, type: string|null, hit: boolean, critical: boolean,
 *   fell: boolean, maxHp: number}>}} data
 */
export function weaponFeed({ devours=false, critAmount=0, victims=[] }) {
  let tempHp = 0;
  const slain = [];
  for ( const v of victims ) {
    if ( SOULLESS.includes(v.type) ) continue;
    if ( devours && v.fell ) { slain.push(v.id); tempHp = Math.max(tempHp, Number(v.maxHp) || 0); }
    if ( (critAmount > 0) && v.hit && v.critical ) tempHp = Math.max(tempHp, critAmount);
  }
  return { tempHp, slain };
}

/**
 * §356: cursed weapons that seize their bearer when it is hurt (`wrath`) — Berserker Axe (`berserk`: "whenever
 * another creature deals damage to you") and "Sword of Vengeance" (`vengeance`: "… in combat"). Is the save due?
 * @param {{kind: "berserk"|"vengeance", byOther: boolean, inCombat: boolean, marked: boolean}} data
 */
export function wrathSaveDue({ kind, byOther, inCombat, marked }) {
  if ( !byOther || marked ) return false;
  return (kind === "vengeance") ? inCombat : true;
}

/**
 * §356: does the wrath end, at the start of the bearer's turn? "Furious Madness": "when you start your turn with no creature
 * within 18 m of you"; vengeance: "until you drop to 0 HP, or it does".
 * @param {{kind: "berserk"|"vengeance", othersNear: boolean, foeDown: boolean, bearerDown: boolean}} data
 */
export function wrathEnds({ kind, othersNear, foeDown, bearerDown }) {
  if ( bearerDown ) return true;
  return (kind === "vengeance") ? foeDown : !othersNear;
}
