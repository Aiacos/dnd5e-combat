/**
 * Issue #31: house rule for healing potions, disabled by default — "Bonus Action: one drinks or makes another drink and rolls
 * the healing (2024 rule); action: the healing is maximal" (Potion of Healing 2d4 + 2 → 10 HP).
 *
 * Only potions whose healing activity costs a Bonus Action (the 2024 data) offer this choice: an old copy that already costs
 * an action (2014 rule) stays as it is (user decision, 2026-11-07).
 *
 * Pure: no dependency on Foundry.
 */

/** The two ways to drink. `bonus`: the 2024 rule (healing rolled); `action`: maximal healing. */
export const POTION_MODES = Object.freeze(["bonus", "action"]);

/**
 * What the rule lets one choose now.
 * - Out of combat: nothing to ask, the healing is maximal (an action costs nothing there; Henrique's choice in the issue).
 * - In combat: both if the action and the Bonus Action are free; the one that remains otherwise; none free: the 2024 rule (the
 *   legality check will say what is missing).
 * @param {object} state
 * @param {boolean} state.inCombat
 * @param {{action?: number, bonus?: number}|null} [state.budget]  The user's turn budget (null out of combat).
 * @returns {{ ask: boolean, mode: "bonus"|"action"|null, available: {bonus: boolean, action: boolean} }}
 *   `ask`: ask the question; otherwise `mode` is the choice made by default.
 */
export function potionChoice({ inCombat, budget=null }) {
  if ( !inCombat ) return { ask: false, mode: "action", available: { bonus: true, action: true } };
  const available = { bonus: (budget?.bonus ?? 1) >= 1, action: (budget?.action ?? 1) >= 1 };
  if ( available.bonus && available.action ) return { ask: true, mode: null, available };
  if ( available.action ) return { ask: false, mode: "action", available };
  return { ask: false, mode: "bonus", available };
}

/**
 * The choice already made by the caller (the Combat UI, the menu), if valid.
 * @param {*} value
 * @returns {"bonus"|"action"|null}
 */
export function chosenPotionMode(value) {
  return POTION_MODES.includes(value) ? value : null;
}

/**
 * The cost to impose on the use for this choice: the action for maximal healing, nothing more for the Bonus Action (that of the
 * data). Out of combat the cost is not counted.
 * @param {"bonus"|"action"} mode
 * @returns {"action"|null}
 */
export function costForPotionMode(mode) {
  return (mode === "action") ? "action" : null;
}
