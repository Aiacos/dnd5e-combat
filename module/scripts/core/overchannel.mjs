/**
 * Overchannel (Wizard, Evoker 14 — SRD 5.2): "when you cast a Wizard spell with a level 1 to 5 spell slot that
 * deals damage, you can deal maximum damage with that spell on the turn you cast it. The first time, with no
 * backlash. If you use it again before a Long Rest, you take 2d12 Necrotic damage per level of the
 * slot right after casting it; this damage ignores Resistance and Immunity. With each new use before a
 * Long Rest, the Necrotic damage per level increases by 1d12." Pure functions.
 */

/**
 * Can this cast be overchanneled?
 * @param {{maxLevel: number, class?: string}} rule
 * @param {{isSpell: boolean, baseLevel: number, castLevel: number, sourceClass?: string|null}} cast  `sourceClass` empty:
 *   unknown, allowed
 */
export function overchannelApplies(rule, { isSpell, baseLevel, castLevel, sourceClass=null }) {
  if ( !rule || !isSpell || !(baseLevel >= 1) || !(castLevel >= 1) || (castLevel > rule.maxLevel) ) return false;
  return !rule.class || !sourceClass || (sourceClass === rule.class);
}

/**
 * The damage dice at their maximum: what changes in the aggregate, part by part (type and properties).
 * @param {Array<{type: string|null, properties: string[], value: number, faces: number}>} dice
 * @returns {Array<{type: string|null, properties: string[], old: number, now: number}>}  nothing for a part already at maximum
 */
export function maximizedDeltas(dice) {
  const parts = new Map();
  for ( const die of dice ?? [] ) {
    const key = `${die.type ?? ""}|${[...(die.properties ?? [])].sort().join(",")}`;
    const part = parts.get(key) ?? { type: die.type ?? null, properties: [...(die.properties ?? [])], old: 0, now: 0 };
    part.old += Number(die.value) || 0;
    part.now += Number(die.faces) || 0;
    parts.set(key, part);
  }
  return [...parts.values()].filter(p => p.now !== p.old);
}

/**
 * The number of d12 of the backlash: nothing on the first use since the Long Rest, then (rank of the use) per slot
 * level — 2 per level on the second, 3 on the third…
 * @param {number} use        the rank of this use since the last Long Rest (1 = the first)
 * @param {number} castLevel
 */
export function backlashDice(use, castLevel) {
  return (use >= 2) ? use * castLevel : 0;
}
