/**
 * §258: generic endings of a spell or an effect (`endsWhen`, CAT / CPR audit of 2026-10-28) — what decides, without Foundry:
 *  - `armor`: the bearer dons armor ("any": Mage Armor) or heavy armor ("heavy": Rage);
 *  - `apart`: the bearer and the caster are separated by more than the distance (Warding Bond: 18 m; Compelled Duel: 9 m at the end
 *    of the caster's turn);
 *  - `zeroHp`: the bearer and/or the caster drops to 0 HP (`true` = either; `"caster"`: Warding Bond, issue #150) ;
 *  - `unaffected`: the use affected no one (all saves succeeded, no hit) — Concentration drops,
 *    the spell has nothing left to hold (Hold Person, Banishment…). Table convenience, world setting.
 *
 *  - §495 `healedByMagic`: the bearer receives magical healing ("until it receives magical healing").
 *
 * Pure: no dependency on Foundry.
 */

import { isMagicalUse } from "./antimagic.mjs";

/** The armor weights of dnd5e (`system.type.value` of an equipment item), from lightest to heaviest. */
export const ARMOR_WEIGHTS = Object.freeze(["light", "medium", "heavy"]);

/** Does armor of this weight, just donned, end the effect? `rule`: "any" or "heavy". */
export function armorEnds(rule, weight) {
  if ( !ARMOR_WEIGHTS.includes(weight) ) return false;
  if ( rule === "any" ) return true;
  return (rule === "heavy") && (weight === "heavy");
}

/** Who a `zeroHp` rule watches: `true` (legacy) or "either", "bearer", "caster". */
export const ZERO_HP_WHO = Object.freeze(["bearer", "caster", "either"]);

/**
 * Does dropping to 0 HP end the effect? `rule`: the `zeroHp` value; `isBearer` / `isCaster`: the creature at 0 HP is the effect's
 * bearer / the caster of its item. Warding Bond (SRD 5.2): "if you drop to 0 Hit Points" — the caster only (issue #150).
 */
export function zeroHpEnds(rule, { isBearer = false, isCaster = false } = {}) {
  if ( !rule ) return false;
  const who = (rule === true) ? "either" : rule;
  if ( !ZERO_HP_WHO.includes(who) ) return false;
  return (isBearer && ["bearer", "either"].includes(who)) || (isCaster && ["caster", "either"].includes(who));
}

/** Are two creatures `distance` apart (in the unit of the limit) farther apart than `limit`? Unknown: no. */
export function tooFarApart(distance, limit) {
  return Number.isFinite(distance) && Number.isFinite(limit) && (distance > limit + 1e-6);
}

/**
 * Did the resolved use affect no one? Targets that the action could not affect (`unaffected`: type, immunity)
 * do not count.
 *  - "failedSave": no target failed its save (an automatic failure counts as failed);
 *  - "noHits": no attack hit;
 *  - "noTargets": no affectable target.
 * A resolution with no save judged (pending) has decided nothing: no.
 * @param {{targets: object[], plan?: object}} resolution
 * @param {"failedSave"|"noHits"|"noTargets"} condition
 */
export function nobodyAffected(resolution, condition) {
  const targets = (resolution?.targets ?? []).filter(t => !t.unaffected);
  if ( condition === "noTargets" ) return !targets.length;
  if ( !targets.length ) return true;
  if ( condition === "noHits" ) return targets.every(t => t.hit === false);
  if ( condition === "failedSave" ) {
    if ( targets.some(t => !t.save) ) return false;
    return targets.every(t => t.save.success === true);
  }
  return false;
}

/**
 * §275: only the original use says whether the spell "affected" someone. A repeated save (`resave`: Bestow Curse, start of
 * turn), the replay of an area (`areaTick`) or a recast under concentration (`recast`) decides nothing — otherwise a
 * successful save on replay would drop the concentration of the whole spell (Bestow Curse succeeded: the curse disappeared;
 * Hold Person on two targets: the second freed along with the first). `flags`: the engine's flags on the use message.
 */
export function isReplayUsage(flags) {
  return !!(flags?.resave || flags?.areaTick || flags?.recast);
}

/**
 * §495: are these applied HP a magical heal? A heal (negative amount) coming from a magical use — a cast spell, a
 * magic item activity, a feature that the content says is `magical` (core/antimagic.mjs `isMagicalUse`) — or from a potion. A heal
 * whose source is unknown (HP changed by hand, Hit Die, rest) is not one.
 * @param {number} amount   The amount applied by dnd5e (negative: a heal).
 * @param {{spellCast?: boolean, item?: object, activityType?: string, magical?: boolean}|null} use   as for isMagicalUse.
 */
export function healsMagically(amount, use) {
  if ( !(Number(amount) < 0) || !use ) return false;
  if ( isMagicalUse(use) ) return true;
  return (use.item?.type === "consumable") && (use.item?.subtype === "potion");
}

/**
 * §447: the enchantment that a generic ending can remove — a copy applied to an item (`isAppliedEnchantment` of dnd5e), never the
 * definition that the item carries for its "enchant" activity (Shillelagh: its four profiles): removing it would empty the item,
 * which could no longer enchant anything. `applied` absent (a dnd5e without this flag): every active enchantment counts, as
 * before.
 * §525: except the profile of the object activated in place of a self-enchantment (`ownProfile`, "Savage Wrath":
 * runtime/enchant.mjs) — dnd5e does not count it as applied, but it is the ongoing effect; its end turns it off (`switchesOff`)
 * without removing it.
 * @param {{type?: string, disabled?: boolean, applied?: boolean|null, ownProfile?: boolean}} effect
 * @returns {boolean}
 */
export function isEndableEnchantment({ type, disabled = false, applied = null, ownProfile = false } = {}) {
  return (type === "enchantment") && !disabled && ((applied ?? true) || (ownProfile === true));
}
