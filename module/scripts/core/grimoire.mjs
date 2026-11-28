/**
 * §139: the Wizard's spellbook — rituals (Ritual Adept, and the general rule for rituals) and Arcane Recovery. What can be
 * computed without Foundry.
 *
 * Pure functions, no dependency on Foundry.
 */

/**
 * How to cast a spell that has the Ritual tag (2024 rule: "if you have it prepared, you can cast it as a ritual: 10 minutes
 * longer, without expending a slot"; Wizard's Ritual Adept: "any spell in your spellbook that has the Ritual tag, even if not
 * prepared, but only as a ritual"). A ritual takes 10 minutes: never in combat.
 * @param {{ritual: boolean, requiresSlot: boolean, inCombat: boolean, prepared: boolean, adept: boolean, slotLeft: boolean}} c
 *   `adept`: the caster has Ritual Adept and the spell comes from their spellbook; `slotLeft`: a slot of the spell's level or more.
 * @returns {"none"|"ritual"|"ask"}  "ritual": automatically as a ritual; "ask": ritual or slot, up to the player.
 */
export function ritualMode({ ritual, requiresSlot, inCombat, prepared, adept, slotLeft }) {
  if ( !ritual || !requiresSlot || inCombat ) return "none";
  if ( !prepared ) return adept ? "ritual" : "none";
  return slotLeft ? "ask" : "ritual";
}

/**
 * Where the use of a slot-restoring feature is counted, and whether any is left: on the activity the rule names (Druid's
 * Natural Recovery: the item has no uses, each of its two activities has its own), otherwise on the item (Arcane Recovery).
 * With no counter (`max` null or absent), it is not limited.
 * @param {{value?: number, max?: number|string}|null} itemUses
 * @param {{value?: number, max?: number|string}|null} activityUses  those of the activity named by the rule, if there is one
 * @returns {{on: "activity"|"item"|null, left: boolean}}
 */
export function recoveryUses(itemUses, activityUses=null) {
  const counted = u => Number(u?.max) > 0;
  if ( counted(activityUses) ) return { on: "activity", left: Number(activityUses.value) > 0 };
  if ( counted(itemUses) ) return { on: "item", left: Number(itemUses.value) > 0 };
  return { on: null, left: true };
}

/**
 * Arcane Recovery: "expended slots with a combined level equal to no more than half your Wizard level
 * (rounded up), none of which can be level 6 or higher".
 * @param {number} classLevel
 */
export function recoveryBudget(classLevel) {
  return Math.ceil((Number(classLevel) || 0) / 2);
}

/**
 * The slot levels that can still be recovered: spent (value below the maximum), at most `maxLevel` and at most what is left
 * of the budget.
 * @param {Record<number, {value: number, max: number}>} slots  By level.
 * @param {number} budget  What is left to recover, in levels.
 * @param {number} [maxLevel=5]
 * @returns {number[]}  Ascending.
 */
export function recoverableLevels(slots, budget, maxLevel=5) {
  const out = [];
  for ( let level = 1; level <= Math.min(maxLevel, budget); level++ ) {
    const s = slots?.[level];
    if ( s && (Number(s.value) < Number(s.max)) ) out.push(level);
  }
  return out;
}
