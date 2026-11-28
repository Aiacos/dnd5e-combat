/**
 * Show a player the targets of an action (request to the player's client: their targets set like the engine's).
 * Extracted from adapter/saves.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { fromTrusted } from "../core/requests.mjs";

export const TARGETS_QUERY = `${MODULE_ID}.setTargets`;

/** On the side of whoever cast the spell: their targets become the ones the area covers. */
export function handleTargetsQuery({ tokens }, { user=null }={}) {
  // §472: only the GM sends this request in the game; from a player, it is dropped (security refusal, not forceable).
  if ( !fromTrusted(user) ) { console.warn(`${MODULE_ID} | showTargets query from ${user.name} refused: only a GM sends it`); return false; }
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  for ( const uuid of tokens ) fromUuidSync(uuid)?.object?.setTarget(true, { releaseOthers: false });
  return true;
}

/**
 * Shows the author of an action whom their area caught: the tokens are designated as targets on
 * their side. Purely visual — the resolution does not depend on the interface's targets — so never blocking.
 */
export async function showTargetsTo(user, tokenUuids) {
  try {
    if ( !user || user.isSelf ) handleTargetsQuery({ tokens: tokenUuids });
    else if ( user.active ) await user.query(TARGETS_QUERY, { tokens: tokenUuids }, { timeout: 5000 });
  } catch(err) {
    console.warn(`${MODULE_ID} | targets not shown for ${user?.name}`, err);
  }
}
