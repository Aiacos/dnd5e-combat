/**
 * §409 (issue #44, batch 2): the free hand for the somatic component. Pure: no dependency on Foundry.
 *
 * 2024 rule: a spell with a somatic component (S) needs a free hand; the material component (M) needs a hand for the pouch
 * or the focus, which can be the same as that of S. War Caster: S can be done even with weapons or a shield in hand.
 * A "two-handed" weapon counts as two hands only when attacking (2024): between two blows, it is held with one hand.
 */

/**
 * What the creature holds: one entry per object in hand.
 * @typedef {object} Held
 * @property {string} name
 * @property {number} hands        Hands taken (1; 2 for a "two-handed" weapon when `twoHanded`).
 * @property {boolean} [twoHanded] "Two-handed" weapon (dnd5e `two` property).
 * @property {boolean} [focus]     A spellcasting focus held (staff, wand, orb…).
 * @property {boolean} [armament]  A weapon or a shield (what War Caster covers).
 */

/** Hands taken to cast: a "two-handed" weapon takes only one outside of an attack. */
export function handsUsed(held) {
  return (held ?? []).reduce((n, h) => n + (h.twoHanded ? 1 : Math.max(0, Number(h.hands) || 0)), 0);
}

/**
 * Does the spell run into the lack of a free hand? null if it passes, otherwise `{ items }`: the names of what occupies the hands.
 * @param {object} use
 * @param {boolean} use.spell          The use casts a spell.
 * @param {boolean} use.somatic        It keeps its S component (a "cast" copy of an item that dispenses with it no longer has it).
 * @param {boolean} [use.material]     It has an M component (the focus hand is then enough).
 * @param {Held[]} use.held            What the creature holds.
 * @param {boolean} [use.freeSomatic]  War Caster (content `freeSomatic`).
 * @param {boolean} [use.waived]       S component waived for this cast (Subtle Spell).
 * @returns {{items: string[]}|null}
 */
export function somaticBlocked({ spell, somatic, material=false, held=[], freeSomatic=false, waived=false }) {
  if ( !spell || !somatic || waived ) return null;
  if ( handsUsed(held) < 2 ) return null;
  if ( material && held.some(h => h.focus) ) return null;
  if ( freeSomatic && held.every(h => h.armament) ) return null;
  return { items: held.map(h => h.name) };
}

/** Does the hand check apply to this actor? `somaticHands` setting: "off", "pc" (player characters), "all". */
export function handsCheckedFor(setting, isCharacter) {
  if ( setting === "all" ) return true;
  if ( setting === "off" ) return false;
  return !!isCharacter;
}
