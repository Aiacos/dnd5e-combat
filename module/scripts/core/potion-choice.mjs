/**
 * Issue #31 : règle maison des potions de soins, désactivée par défaut — « action Bonus : on boit ou on fait boire et l'on
 * lance le soin (règle 2024) ; action : le soin est maximal » (Potion de guérison 2d4 + 2 → 10 PV).
 *
 * Seules les potions dont l'activité de soin coûte une action Bonus (la donnée 2024) proposent ce choix : une copie ancienne qui coûte
 * déjà une action (règle 2014) reste telle quelle (décision de l'utilisateur, 2026-11-07).
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les deux façons de boire. `bonus` : la règle 2024 (soin lancé) ; `action` : soin maximal. */
export const POTION_MODES = Object.freeze(["bonus", "action"]);

/**
 * Ce que la règle laisse choisir maintenant.
 * - Hors combat : rien à demander, le soin est maximal (une action n'y coûte rien ; choix d'Henrique dans l'issue).
 * - En combat : les deux si l'action et l'action Bonus sont libres ; celle qui reste sinon ; aucune libre : la règle 2024 (le contrôle
 *   de légalité dira ce qui manque).
 * @param {object} state
 * @param {boolean} state.inCombat
 * @param {{action?: number, bonus?: number}|null} [state.budget]  Le budget du tour de l'utilisateur (null hors combat).
 * @returns {{ ask: boolean, mode: "bonus"|"action"|null, available: {bonus: boolean, action: boolean} }}
 *   `ask` : poser la question ; sinon `mode` est le choix fait d'office.
 */
export function potionChoice({ inCombat, budget=null }) {
  if ( !inCombat ) return { ask: false, mode: "action", available: { bonus: true, action: true } };
  const available = { bonus: (budget?.bonus ?? 1) >= 1, action: (budget?.action ?? 1) >= 1 };
  if ( available.bonus && available.action ) return { ask: true, mode: null, available };
  if ( available.action ) return { ask: false, mode: "action", available };
  return { ask: false, mode: "bonus", available };
}

/**
 * Le choix déjà fait par l'appelant (la Combat UI, le menu), s'il est valable.
 * @param {*} value
 * @returns {"bonus"|"action"|null}
 */
export function chosenPotionMode(value) {
  return POTION_MODES.includes(value) ? value : null;
}

/**
 * Le coût à imposer à l'utilisation pour ce choix : l'action pour le soin maximal, rien de plus pour l'action Bonus (celle de la
 * donnée). Hors combat le coût n'est pas compté.
 * @param {"bonus"|"action"} mode
 * @returns {"action"|null}
 */
export function costForPotionMode(mode) {
  return (mode === "action") ? "action" : null;
}
