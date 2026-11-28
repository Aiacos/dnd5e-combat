/**
 * Resolution of an attack roll against targets. 2024 rules: a natural 20 always hits
 * and is a Critical Hit, a natural 1 always misses. A lowered critical threshold (Improved Critical: 19) does not make the
 * attack hit: a natural 19 is a Critical Hit only if the total reaches the AC. No dependency on Foundry.
 */

/**
 * @typedef {object} AttackRoll
 * @property {number} total        Total of the roll, modifiers included.
 * @property {boolean} isCritical  The d20 reaches the attacker's critical threshold.
 * @property {number} [natural]    The kept d20. Absent (roll of an old message): taken as a 20 when `isCritical`.
 * @property {boolean} isFumble    The d20 is an automatic miss (natural 1).
 */

/**
 * @typedef {object} AttackTarget
 * @property {string} token   UUID of the targeted token.
 * @property {string} name
 * @property {number|null} ac AC of the target; `null` = Total Cover, the attack cannot hit.
 */

/**
 * @param {AttackRoll} roll
 * @param {AttackTarget[]} targets
 * @returns {Array<AttackTarget & {hit: boolean, critical: boolean, reason: string}>}
 */
export function resolveAttack(roll, targets) {
  return targets.map(target => {
    let hit;
    let reason;
    if ( target.ac === null || target.ac === undefined ) { hit = false; reason = "cover"; }
    else if ( roll.isFumble ) { hit = false; reason = "fumble"; }
    else if ( hitsRegardless(roll) ) { hit = true; reason = "critical"; }
    else { hit = roll.total >= target.ac; reason = hit ? (roll.isCritical ? "critical" : "ac") : "miss"; }
    return { ...target, hit, critical: hit && roll.isCritical, reason };
  });
}

/**
 * §207 (house rule, `critMargin` setting, disabled at 0): a hit that is not critical becomes one when the roll's total
 * exceeds the target's AC (Cover included) by at least `margin` — "AC + 10" requested by a table (GitHub issue #5).
 * Judged per target.
 * @param {{hit: boolean, critical: boolean, ac: number|null}} target  The judged target.
 * @param {{total: number}} roll
 * @param {number} margin
 */
export function beatsAcBy(target, roll, margin) {
  return (Number(margin) > 0) && !!target?.hit && !target.critical && Number.isFinite(target.ac) && (roll.total >= target.ac + Number(margin));
}

/**
 * §39.2: the attack mode of a weapon that can be thrown, before the roll dialog. dnd5e takes the LAST mode used
 * (activity/attack.mjs:95, flag `last.<activité>.attackMode`): after a dagger throw, a melee attack
 * went back to "thrown" (judged as ranged: Disadvantage against an adjacent enemy, throwing range). A mode taken from
 * memory is therefore not a choice: against a target within reach, a remembered "thrown" goes back to being the default mode.
 * @param {object} data
 * @param {string|null} data.requested      The mode of the roll configuration (dnd5e, or requested by a caller).
 * @param {string|null} data.remembered     The last mode remembered by dnd5e for this activity.
 * @param {string|null} data.byDefault      The first mode of the weapon (dnd5e's default).
 * @param {boolean} data.hasTargets         Targets are designated.
 * @param {boolean} data.allBeyondReach     All the targets are out of reach.
 * @param {boolean} data.canThrow           The weapon has a "thrown" mode.
 * @returns {string|null}  The mode to impose, or null to leave the configuration as it is.
 */
/**
 * §149: Versatile weapon ("can be wielded in one or two hands", larger die in two hands) — as in BG3, the two-handed grip when
 * nothing occupies the other hand (no shield, no other held weapon). A mode chosen by the player (menu, dnd5e window)
 * is kept; a throw or an off-hand do not change.
 * §151: a weapon whose two-handed damage is empty (custom formula enabled but empty — the Spear of the pregenerated characters
 * of the Handbook, the guards' in the Bestiary) stays one-handed: in two hands, dnd5e would roll no die.
 * §295: with the Dueling style (+2 damage with a melee weapon held in one hand, and in one hand only), the one-handed grip
 * (`prefersOneHand`): 1d8 + 2 beats 1d10, and the Dueling effect would no longer apply in two hands.
 * @param {{mode: string|null, modes: string[], explicit: boolean, otherHandBusy: boolean,
 *   twoHandedDamage?: boolean, prefersOneHand?: boolean}} data
 *   `mode`: the mode in force (requested, taken from dnd5e's memory, or nothing); `modes`: those of the weapon; `explicit`: chosen;
 *   `twoHandedDamage`: the two-handed grip has damage.
 * @returns {string|null}  "twoHanded" (other hand free) or "oneHanded" (grip), or null to leave the roll as it is.
 */
export function versatileGrip({ mode, modes, explicit, otherHandBusy, twoHandedDamage=true, prefersOneHand=false }) {
  if ( explicit || !modes?.includes("twoHanded") || !modes.includes("oneHanded") ) return null;
  if ( mode && !["oneHanded", "twoHanded"].includes(mode) ) return null;
  // The other hand is taken (shield, other weapon): one hand — even if dnd5e remembered a two-handed grip.
  const want = (otherHandBusy || !twoHandedDamage || prefersOneHand) ? "oneHanded" : "twoHanded";
  return (mode === want) ? null : want;
}

export function throwableAttackMode({ requested, remembered, byDefault, hasTargets, allBeyondReach, canThrow }) {
  const fromMemory = !!requested && (requested === remembered);
  // A mode other than the default, explicitly requested (off-hand, two hands): it is kept.
  if ( requested && (requested !== byDefault) && !fromMemory ) return null;
  if ( !hasTargets ) return null;
  if ( allBeyondReach && canThrow ) return (requested === "thrown") ? null : "thrown";
  // A target within reach: a "thrown" mode taken from memory goes back to being the default mode.
  if ( fromMemory && requested.startsWith("thrown") && byDefault && (byDefault !== requested) ) return byDefault;
  return null;
}

/**
 * O8e (§348): "Disadvantage on attack rolls with weapons other than this one" (Berserker Axe, Oathbow while the sworn
 * enemy lives). The names of the rules that hinder a weapon attack made with the item `attacking`: active, from another item.
 * @param {Array<{item: string, name: string, active: boolean}>} rules
 * @param {string|null} attacking  id of the weapon's item; null if the attack is not a weapon attack
 * @returns {string[]}
 */
export function exclusiveWeaponHindrances(rules, attacking) {
  if ( !attacking ) return [];
  return (rules ?? []).filter(r => r.active && (r.item !== attacking)).map(r => r.name);
}

/**
 * Does this roll hit whatever the AC? Only a natural 20: a d20 at a lowered Critical Hit threshold (19) must still reach
 * the AC — on a miss, it stays a miss like any other (Inspiration is offered, the card does not announce it as a "critical").
 * @param {AttackRoll} roll
 * @returns {boolean}
 */
export function hitsRegardless(roll) {
  return (roll.isCritical === true) && !roll.isFumble && ((roll.natural ?? 20) === 20);
}

/**
 * What the card announces for an attack roll: "critical", "fumble", or nothing. A d20 at a lowered threshold is announced as a
 * critical only if the verdict returned counts a Critical Hit; unknown verdict (card without resolution): announced, as the
 * system does.
 * @param {AttackRoll} roll
 * @param {{hit: boolean, critical: boolean}[]|null} [verdicts]  The targets judged on this roll, or null.
 * @returns {"critical"|"fumble"|null}
 */
export function attackMark(roll, verdicts=null) {
  if ( roll.isFumble ) return "fumble";
  if ( !roll.isCritical ) return null;
  if ( hitsRegardless(roll) || !verdicts ) return "critical";
  return verdicts.some(t => t.hit && t.critical) ? "critical" : null;
}
