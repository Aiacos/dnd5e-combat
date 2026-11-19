/**
 * Montrer à un joueur les cibles d'une action (requête au client du joueur : ses cibles posées comme celles du moteur).
 * Extrait d'adapter/saves.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";

export const TARGETS_QUERY = `${MODULE_ID}.setTargets`;

/** Côté de celui qui a lancé le sort : ses cibles deviennent celles que la zone recouvre. */
export function handleTargetsQuery({ tokens }, { user=null }={}) {
  // §472 : seul le MJ envoie cette requête dans le jeu ; d'un joueur, elle tombe (refus de sécurité, non forçable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | showTargets query from ${user.name} refused: only a GM sends it`); return false; }
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  for ( const uuid of tokens ) fromUuidSync(uuid)?.object?.setTarget(true, { releaseOthers: false });
  return true;
}

/**
 * Montre à l'auteur d'une action qui sa zone a pris : les tokens sont désignés comme cibles chez
 * lui. Purement visuel — la résolution ne dépend pas des cibles de l'interface — donc jamais bloquant.
 */
export async function showTargetsTo(user, tokenUuids) {
  try {
    if ( !user || user.isSelf ) handleTargetsQuery({ tokens: tokenUuids });
    else if ( user.active ) await user.query(TARGETS_QUERY, { tokens: tokenUuids }, { timeout: 5000 });
  } catch(err) {
    console.warn(`${MODULE_ID} | targets not shown for ${user?.name}`, err);
  }
}
