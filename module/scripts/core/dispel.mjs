/**
 * §37.2: Dispel Magic (Player's Handbook 2024) — active spells on the target up to level 3 are dispelled without a
 * roll; beyond that, each requires an ability check with the spellcasting ability against a DC of 10 + its level. Cast with a
 * slot of level 4 or higher, it also dispels without a roll any spell whose level does not exceed that of the slot.
 * §496 (brick B16): a bounded dispel — `dispel: { upTo, beyond: "none" | "check", keepBySlot? }`: up to level `upTo`
 * (whatever the slot) spells end; beyond that, nothing (`none`, no check) or the 2024 check (`check`).
 *
 * Pure functions, no dependency on Foundry.
 */

/** Up to which level a spell ends automatically, for a Dispel cast at this level (at least 3). */
export function autoDispelLevel(slotLevel) {
  return Math.max(3, Number(slotLevel) || 3);
}

/**
 * §496: the declared rule, in a single form. `true`: the 2024 Dispel Magic (ceiling = the slot, check beyond).
 * @param {true|{upTo?: number, beyond?: "none"|"check", keepBySlot?: true}} value
 * @returns {{upTo: number|null, beyond: "none"|"check", keepBySlot: boolean}|null}  null if the item dispels nothing.
 */
export function dispelRule(value) {
  if ( value === true ) return { upTo: null, beyond: "check", keepBySlot: false };
  if ( !value || (typeof value !== "object") ) return null;
  return {
    upTo: Number.isInteger(value.upTo) ? value.upTo : null,
    beyond: (value.beyond === "none") ? "none" : "check",
    keepBySlot: value.keepBySlot === true
  };
}

/**
 * What happens to each ongoing spell: `auto` (it ends), a check against `dc`, or nothing (`none`: out of reach of the rule).
 * @param {Array<{key: string, level: number}>} spells  One per cast spell (casting level).
 * @param {number} slotLevel                            Level at which Dispel is cast.
 * @param {{upTo?: number|null, beyond?: "none"|"check"}} [rule]  §496: fixed ceiling and what happens beyond.
 * @returns {Array<{key: string, level: number, auto: boolean, dc: number|null, none?: true}>}
 */
export function dispelPlan(spells, slotLevel, { upTo=null, beyond="check" }={}) {
  const ceiling = Number.isInteger(upTo) ? upTo : autoDispelLevel(slotLevel);
  return spells.map(({ key, level }) => {
    const lvl = Math.max(0, Number(level) || 0);
    if ( lvl <= ceiling ) return { key, level: lvl, auto: true, dc: null };
    return (beyond === "none") ? { key, level: lvl, auto: false, dc: null, none: true } : { key, level: lvl, auto: false, dc: 10 + lvl };
  });
}
