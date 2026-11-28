/**
 * §274: the choice of a weapon's ammunition (issue #23). dnd5e offers the list of ammunition only in its attack roll
 * window; without that window (rolls without a dialog), it takes the last ammunition retained on the weapon
 * (`flags.dnd5e.last.<activité>.ammunition`, activity/attack.mjs:94), even if used up, and a forgotten ammunition becomes "none".
 *
 * Pure: no dependency on Foundry.
 */

/**
 * The ammunition an attack will fire, and whether to ask.
 * @param {object} state
 * @param {Array<{id: string, quantity: number}>} state.options  The ammunition the weapon can fire (dnd5e `ammunitionOptions`).
 * @param {string|null} [state.remembered]  The last ammunition retained by dnd5e on the activity.
 * @param {string|null} [state.explicit]    An ammunition imposed by the caller (use configuration, neighbour).
 * @returns {{use: string|null, ask: boolean, usable: string[]}}
 *   `use`: the ammunition retained (or preselected when `ask`); `ask`: several usable ammunitions and no imposed choice.
 */
export function ammoChoice({ options=[], remembered=null, explicit=null }={}) {
  const usable = options.filter(o => o.quantity > 0).map(o => o.id);
  if ( explicit && options.some(o => o.id === explicit) ) return { use: explicit, ask: false, usable };
  // Nothing usable left: we let dnd5e and legality (§142) say "no more ammunition".
  if ( !usable.length ) return { use: options.some(o => o.id === remembered) ? remembered : (options[0]?.id ?? null), ask: false, usable };
  const use = usable.includes(remembered) ? remembered : usable[0];
  return { use, ask: usable.length > 1, usable };
}
