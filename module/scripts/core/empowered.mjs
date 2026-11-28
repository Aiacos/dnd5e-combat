/**
 * Empowered Spell (Metamagic, SRD 5.2): "when you roll damage for a spell, you can spend 1 Sorcery Point
 * to reroll a number of the damage dice up to your Charisma modifier (minimum of one); you must use the
 * new rolls". The engine offers the dice worth half their maximum or less, lowest first. Pure functions.
 */

/**
 * The dice to reroll: at most `count`, among those worth half their maximum or less, from lowest (relative to its
 * faces) to highest; on a tie, the die with the most faces (more to gain).
 * @param {Array<{value: number, faces: number}>} dice
 * @param {number} count
 * @returns {number[]}  the indices in `dice`
 */
export function empoweredPicks(dice, count) {
  const limit = Math.max(1, Math.floor(Number(count) || 0));
  return (dice ?? []).map((d, index) => ({ index, value: Number(d.value), faces: Number(d.faces) }))
    .filter(d => (d.faces > 1) && (d.value <= d.faces / 2))
    .sort((a, b) => (a.value / a.faces) - (b.value / b.faces) || (b.faces - a.faces) || (a.index - b.index))
    .slice(0, limit).map(d => d.index);
}

/**
 * What the reroll changes in the damage aggregate, part by part (type and properties): the old total of the rerolled dice and the
 * new one.
 * @param {Array<{type: string|null, properties: string[], value: number}>} picked  the rerolled dice
 * @param {number[]} rerolled                                                       their new values, in the same order
 * @returns {Array<{type: string|null, properties: string[], old: number, now: number}>}
 */
export function empoweredDeltas(picked, rerolled) {
  const parts = new Map();
  picked.forEach((die, i) => {
    const key = `${die.type ?? ""}|${[...(die.properties ?? [])].sort().join(",")}`;
    const part = parts.get(key) ?? { type: die.type ?? null, properties: [...(die.properties ?? [])], old: 0, now: 0 };
    part.old += Number(die.value) || 0;
    part.now += Number(rerolled[i]) || 0;
    parts.set(key, part);
  });
  return [...parts.values()];
}
