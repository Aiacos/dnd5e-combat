/**
 * §93: a d20 Test whose KEPT d20 is a 1 (with Advantage or Disadvantage, the retained die). Pure: rolls described by their first
 * term (`d20.total`, dnd5e's: D20Roll#d20, the total of the active results).
 * @param {Array<{d20?: {total?: number}}>} rolls
 * @returns {boolean}
 */
export function rolledNaturalOne(rolls) {
  return (rolls ?? []).some(r => Number(r?.d20?.total) === 1);
}
