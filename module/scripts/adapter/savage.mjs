/**
 * §516 : Sauvagerie martiale (`savageAttacker`, don d'origine, SRD 5.2) — « une fois par tour, quand vous touchez une cible avec une
 * arme, vous pouvez lancer deux fois les dés de dégâts de l'arme et garder l'un ou l'autre ». Le personnage choisit le coup : en mode
 * « ask » (réglage de monde, défaut), une case dans la fenêtre « au toucher » (adapter/sneak.mjs, askHitOptions) ; refusée, elle
 * reste pour un autre coup du même tour. En mode « auto », le premier coup d'arme du tour, comme avant. Les dés se lancent au hook du
 * jet (runtime/feats.mjs) ; le tour où elle a servi est un flag de l'acteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { combatantFor } from "./turn.mjs";

/** Réglage de monde : la Sauvagerie martiale est demandée à chaque coup éligible (« ask ») ou mise d'office au premier (« auto »). */
export const SAVAGE_MODE_SETTING = "savageAttackerMode";
export const SAVAGE_MODES = Object.freeze(["ask", "auto"]);

/** Le mode du monde (« auto », l'ancien comportement, si le réglage n'est pas lisible). */
export function savageMode() {
  try {
    const mode = game.settings.get(MODULE_ID, SAVAGE_MODE_SETTING);
    return SAVAGE_MODES.includes(mode) ? mode : "auto";
  } catch { return "auto"; }
}

/** Le tour de combat où se bat l'acteur (« combat.round.tour »), ou null hors combat. */
export function savageTurnOf(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

/** Une attaque d'arme (pas à mains nues) d'un acteur qui a la règle. */
export function savageApplies(activity) {
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || (activity.item?.type !== "weapon") ) return false;
  if ( activity.attack?.type?.classification === "unarmed" ) return false;
  return Array.from(actor.items ?? []).some(i => contentOf(i).entry?.savageAttacker === true);
}

/** Déjà servie ce tour-ci ? (Hors combat : jamais, chaque coup peut l'avoir.) */
export function savageSpent(actor) {
  const turn = savageTurnOf(actor);
  return !!turn && (actor.getFlag(MODULE_ID, "savageAttacker") === turn);
}

/** Faut-il poser la question pour ce coup ? (mode « ask », règle applicable, pas encore servie ce tour) */
export function savageToAsk(activity) {
  return (savageMode() === "ask") && savageApplies(activity) && !savageSpent(activity.actor);
}
