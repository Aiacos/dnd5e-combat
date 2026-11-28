/**
 * §129: the Player's Handbook origin feats — what is computed without Foundry.
 *
 * Pure functions, no dependency on Foundry.
 */

import { alliedSides } from "./factions.mjs";

/** The first dice term of a part: number, faces, modifiers. */
const FIRST_DIE = /(\d*)d(\d+)((?:[a-z]+\d*)*)/;

/**
 * §132: Piercer — "reroll one of the attack's damage dice, you must use the new roll". The engine does not reroll
 * afterwards: the first dice term of the part rolls one more die and keeps the best ("1d8" → "2d8kh1", "2d6" →
 * "3d6kh2") — that is rerolling the lowest while keeping the better of the two, a little more favorable than the letter. A part
 * already in a pool (Savage Attacker) or that already keeps is not touched.
 * @param {string} part
 * @returns {string}
 */
export function oneMoreKeepBest(part) {
  const s = String(part);
  if ( s.includes("{") ) return s;
  return s.replace(FIRST_DIE, (term, n, faces, mods) => (/k/.test(mods) ? term : `${(Number(n) || 1) + 1}d${faces}${mods}kh${Number(n) || 1}`));
}

/** A dice term of a formula, with its modifiers ("1d12", "2d6min3", "1d4r1"). */
const DICE = /(\d*d\d+(?:[a-z]+\d*)*)/g;

/**
 * Savage Attacker: "roll the weapon's damage dice twice and use either roll". Each dice term of the
 * part becomes a pool of the two rolls of which the best is kept ("{1d12,1d12}kh"); the rest of the part (modifier) does not move.
 * @param {string} part
 * @returns {string}
 */
export function twiceKeepHighest(part) {
  return String(part).replace(DICE, term => `{${term},${term}}kh`);
}

/**
 * Healer: "you can reroll the die if it rolls a 1, and you must use the new roll" — once ("r1": Foundry rerolls once,
 * "rr" would reroll endlessly). A term that already rerolls is not touched.
 * @param {string} part
 * @returns {string}
 */
export function rerollOnesOnce(part) {
  return String(part).replace(DICE, term => (/r/.test(term.replace(/^\d*d\d+/, "")) ? term : `${term}r1`));
}

/**
 * Alert: the allies to swap Initiative with — same side, an Initiative already rolled, neither Incapacitated nor at 0 HP,
 * other than oneself.
 * @param {{id: string, disposition: number, initiative: number|null, incapacitated?: boolean, down?: boolean}} self
 * @param {Array<typeof self>} others
 * @returns {string[]}  The ids, in the order received.
 */
export function swapPartners(self, others) {
  if ( self.incapacitated || self.down || !Number.isFinite(self.initiative) ) return [];
  return others.filter(o => (o.id !== self.id) && alliedSides(o, self) && Number.isFinite(o.initiative)
    && !o.incapacitated && !o.down).map(o => o.id);
}

/**
 * §130: does the condition of a feat effect (`effectWhile`) hold? What the Handbook does not say in its data:
 *  - `armor`: the worn armor is one of these types (Defense: "while you are wearing light, medium, or heavy armor");
 *  - `oneHanded`: only one weapon wielded, melee and without the Two-Handed property (Dueling: "a melee weapon in one
 *    hand and no other weapons" — a shield is not a weapon);
 *  - `inCombat`: the creature is fighting ("Stealthy Ranger", "Fog of War": "the Hide action during a combat");
 *  - `abilityAtLeast`: minimum ability scores (Medium Armor Master: Dexterity 16).
 * @param {{armor?: string[], notArmor?: string[], oneHanded?: true, inCombat?: true, abilityAtLeast?: Record<string, number>}} rule
 * @param {{armor: string|null, weapons: Array<{melee: boolean, twoHanded: boolean}>, inCombat: boolean,
 *   abilities: Record<string, number>}} facts
 * @returns {boolean}
 */
export function effectHolds(rule, facts) {
  if ( rule.armor && !rule.armor.includes(facts.armor) ) return false;
  // `notArmor` — not this kind of armor: "while you are not wearing heavy armor" (Fast Movement, Roving). Without
  // armor, the condition holds.
  if ( rule.notArmor && rule.notArmor.includes(facts.armor) ) return false;
  if ( rule.oneHanded ) {
    const w = facts.weapons ?? [];
    if ( (w.length !== 1) || !w[0].melee || w[0].twoHanded ) return false;
  }
  if ( rule.inCombat && !facts.inCombat ) return false;
  // O7 (§343): `unarmored` — neither armor nor shield (Bracers of Defense).
  if ( rule.unarmored && (facts.armor || facts.shield) ) return false;
  // §135: `light` — the light where the bearer stands (Boon of the Night Spirit: "in Dim Light or Darkness").
  if ( rule.light && !rule.light.includes(facts.light) ) return false;
  // C12-c: `wildShaped` — under a Wild Shape (Improved Circle Forms); `hasEffect` — an Active Effect of this item (Full of
  // Stars: under the Starry Form).
  if ( rule.wildShaped && !facts.wildShaped ) return false;
  if ( rule.hasEffect && !(facts.effectsFrom?.has?.(rule.hasEffect)) ) return false;
  for ( const [ability, min] of Object.entries(rule.abilityAtLeast ?? {}) ) {
    if ( !((facts.abilities?.[ability] ?? 0) >= min) ) return false;
  }
  return true;
}

/** Are an effect's changes already those the rule asks for (key, type, value — in order)? */
export function sameChanges(current=[], wanted=[]) {
  const norm = list => list.map(c => `${c.key}|${c.type ?? ""}|${String(c.value)}`);
  return JSON.stringify(norm(current)) === JSON.stringify(norm(wanted));
}

/**
 * §136: Polearm Master — "a Quarterstaff, a Spear, or a weapon that has the Heavy and Reach properties".
 * @param {{baseItem?: string, properties?: Iterable<string>}} weapon
 */
export function polearmFits(weapon) {
  const props = new Set(weapon?.properties ?? []);
  return ["quarterstaff", "spear"].includes(weapon?.baseItem) || (props.has("hvy") && props.has("rch"));
}

/** §131: the Player's Handbook crossbows (dnd5e base weapon identifiers). */
export const CROSSBOWS = Object.freeze(["handcrossbow", "heavycrossbow", "lightcrossbow"]);

/**
 * §131: what the shooting feats grant THIS attack (Sharpshooter, Crossbow Expert, Spell Sniper). Each `rangedFeat` rule
 * applies to a kind of attack (`kind`): "weapon" (ranged attack with a weapon, thrown included), "crossbow"
 * (a crossbow), "spell" (spell attack roll).
 * @param {object[]} rules  The `rangedFeat` rules of the bearer's items.
 * @param {{weapon: boolean, ranged: boolean, crossbow: boolean, spell: boolean}} attack
 * O5a (§339): `loading` — the Loading property does not limit these weapons (Crossbow Expert).
 * @returns {{cover: boolean, closeCombat: boolean, longRange: boolean, offhandModifier: boolean, loading: boolean,
 *   spellRange: object|null}}
 */
export function rangedFeatsFor(rules, attack) {
  const out = { cover: false, closeCombat: false, longRange: false, offhandModifier: false, loading: false, spellRange: null };
  for ( const r of rules ?? [] ) {
    const fits = (r.kind === "weapon") ? (attack.weapon && attack.ranged)
      : (r.kind === "crossbow") ? (attack.weapon && attack.crossbow)
      : (r.kind === "spell") ? attack.spell : false;
    if ( !fits ) continue;
    for ( const k of ["cover", "closeCombat", "longRange", "offhandModifier", "loading"] ) if ( r[k] === true ) out[k] = true;
    // `cover: "half"`: only Half Cover is ignored (Wand of the War Mage) — another feat that ignores all of them wins.
    if ( (r.cover === "half") && !out.cover ) out.cover = "half";
    if ( r.spellRange ) out.spellRange = r.spellRange;
  }
  return out;
}

/**
 * What makes an attack ignore Cover, combined: a shooting feat of the bearer, the Favored Enemy, the item itself
 * (`attackIgnoresCover`). The strongest wins — `true` (Half and Three-Quarters), then `"half"` (Half only), otherwise `false`.
 * @param {...(boolean|"half"|null|undefined)} values
 * @returns {true|"half"|false}
 */
export function coverIgnoreOf(...values) {
  if ( values.some(v => v === true) ) return true;
  return values.some(v => v === "half") ? "half" : false;
}

/**
 * §131: the Cover that the rule leaves: Half or Three-Quarters Cover ignored; Total Cover remains. `ignores` is "half" when
 * only Half Cover is ignored: Three-Quarters Cover then remains too.
 */
export function coverLeft(cover, ignores) {
  if ( !cover || !ignores ) return cover;
  if ( ignores === "half" ) return (cover.degree === "half") ? null : cover;
  return (cover.degree === "total") ? cover : null;
}

/**
 * §447: `ignoresResistance.from` — is the activity that deals the damage one of these activities of the item, or a spell copy
 * that one of them had cast (`cachedFor` = "…Item.<item>.Activity.<activity>", dnd5e activity/cast.mjs)? Without `from`: all.
 * @param {string[]|undefined} from
 * @param {{itemId: string, activityItemId?: string, activityId?: string, cachedFor?: string}} at
 */
export function resistanceRuleCovers(from, { itemId, activityItemId=null, activityId=null, cachedFor=null }={}) {
  if ( !from ) return true;
  if ( (activityItemId === itemId) && from.includes(activityId) ) return true;
  const m = (typeof cachedFor === "string") ? cachedFor.match(/Item\.([A-Za-z0-9]{16})\.Activity\.([A-Za-z0-9]{16})$/) : null;
  return !!m && (m[1] === itemId) && from.includes(m[2]);
}
