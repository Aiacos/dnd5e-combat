/**
 * Usage limits of an activity that dnd5e does not control (SPEC §16.40, `usageLimits` key of core/content.mjs):
 *  - `oncePerTurn`: "once on each of your turns" — in combat, only on one's own turn, and once;
 *  - `whenEmpty`: only when the item with this identifier has no uses left (Wild Resurgence: "if you have no uses
 *    of Wild Shape left");
 *  - `lowestSlot`: the spell slot spent is automatically the lowest available, without a window;
 *  - `unmoved`: only if one has not moved this turn (Steady Aim, §20) — in combat;
 *  - `whileEffect` (§486): only under an effect (identifier of an item whose effect is carried, or effect id; a list = any one
 *    of them) — "Claws (requires Change Appearance)", single-form weapons; `unlessEffect`: only outside these
 *    effects (the weapon of the humanoid form). In combat or not;
 *  - `light`: only in one of these lights, where the user stands (One with Shadows: "in
 *    Dim Light or Darkness"); unknown light (no token, no canvas): nothing is objected to.
 * Pure functions.
 */

/**
 * What is wrong, in flexible mode (the player may override).
 * @param {{oncePerTurn?: boolean, whenEmpty?: string, unmoved?: boolean, light?: string[]}} rule
 * @param {{inCombat: boolean, ownTurn: boolean, usedThisTurn: boolean, remaining: number|null, moved?: boolean,
 *   underEffect?: boolean|null, barredByEffect?: boolean|null}} state  `underEffect`: one of the `whileEffect` effects is carried;
 *   `barredByEffect`: one of the `unlessEffect` effects is carried;
 *   `light`: "dark", "dim", "bright", or null if it is not known.
 * @returns {string[]}  "notOwnTurn", "oncePerTurn", "notEmpty", "moved", "needsEffect", "barredByEffect",
 *   "wrongLight".
 */
export function usageLimitIssues(rule, { inCombat, ownTurn, usedThisTurn, remaining, moved=false, underEffect=null, barredByEffect=null,
  light=null }) {
  const issues = [];
  if ( rule?.oncePerTurn && inCombat ) {
    if ( !ownTurn ) issues.push("notOwnTurn");
    else if ( usedThisTurn ) issues.push("oncePerTurn");
  }
  if ( rule?.whenEmpty && Number.isFinite(remaining) && (remaining > 0) ) issues.push("notEmpty");
  if ( rule?.unmoved && inCombat && moved ) issues.push("moved");
  if ( rule?.whileEffect && (underEffect === false) ) issues.push("needsEffect");
  if ( rule?.unlessEffect && (barredByEffect === true) ) issues.push("barredByEffect");
  if ( rule?.light && light && !rule.light.includes(light) ) issues.push("wrongLight");
  // `automatic`: the engine already plays this activity by itself (a trigger of the same item); also casting it by hand would
  // play it twice ("Thunder Hammer", Guide 3.0.0: "Thunderclap"). Forceable refusal, in combat or not.
  if ( rule?.automatic ) issues.push("automatic");
  return issues;
}

/**
 * §16.40: the lowest spell slot level still available, or null. For an activity where the level changes nothing
 * (Wild Shape regain: "by expending a spell slot"): spending higher is wasteful.
 * @param {Record<number, number>} available  Slots remaining per level (1 to 9).
 */
export function lowestSlotLevel(available) {
  for ( let level = 1; level <= 9; level++ ) if ( (Number(available[level]) || 0) > 0 ) return level;
  return null;
}

/** §486: `whileEffect` / `unlessEffect` as a list (a single string = a list of one). */
export const effectRefs = value => (value == null) ? [] : [value].flat().filter(v => (typeof v === "string") && v);

/**
 * Core#98: a feature of which only one option is taken per Rage (Predator's Rage: "when you activate your Rage, choose
 * one of the following options") — while raging, an option already taken (a copy of the item's effect on the barbarian)
 * refuses the next.
 * Outside Rage, nothing to refuse here (the option would have no effect: `duringRage`).
 * @param {{oneOption?: boolean, raging: boolean, taken: number}} state  `taken`: the item's option effects already carried.
 */
export const secondRageOption = ({ oneOption=false, raging=false, taken=0 }={}) => (oneOption === true) && !!raging && (Number(taken) > 0);
