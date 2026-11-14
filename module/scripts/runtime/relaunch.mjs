/**
 * §448 : relancer une utilisation suspendue par le moteur (visée, fenêtre de légalité, choix d'une forme, d'un rituel…). Une utilisation
 * déjà forcée dans un champ antimagie (`antimagicForced`, runtime/antimagic.mjs) garde le champ levé pour sa relance : dnd5e vérifie
 * `canUse` dès l'entrée de `use()` et refuserait sinon, sans carte, après que le MJ a été prévenu du forçage (vu sur le banc le
 * 2026-11-14 : Baguette de projectiles magiques, visée des trois projectiles, rien ne part). Toute relance d'une configuration reçue
 * passe par ici (règle « relance-forcee » de tests/das-tests.json).
 */

import { MODULE_ID } from "../constants.mjs";
import { withAntimagicLifted } from "./antimagic.mjs";

/** `activity.use(usage, dialog, message)`, le champ antimagie levé le temps de l'appel si l'utilisation a été forcée. */
export function relaunchUse(activity, usage, dialog, message) {
  if ( !usage?.[MODULE_ID]?.antimagicForced ) return activity.use(usage, dialog, message);
  return withAntimagicLifted(activity.actor, activity.item, () => activity.use(usage, dialog, message));
}
