/**
 * §290: combat windows without delay (user's request, 2026-10-30). World setting `combatWindowUnlimited`: a
 * question asked to a player (Reaction, choice, saving throw…) waits for their answer with no countdown; the GM sees who they
 * are waiting for (ui/player-waits.mjs, opens by itself at the end of the windows' delay) and can **force**: the window closes
 * on the player's side with the answer the delay would have given. A player who disconnects counts as no answer
 * (adapter/player-wait.mjs).
 *
 * Feedback to the table when the GM forces: text above the character's token and sound, on each client.
 */

import { MODULE_ID } from "../constants.mjs";
import { FORCE_WINDOWS_QUERY, forcePlayerWait, handleForceWindows, playerWaits } from "../adapter/player-wait.mjs";
import { log, notice, tokenOfActor } from "./shared.mjs";

/**
 * The GM forces the wait `id` (tracker window, token menu, `api.waits.force`).
 * @param {string} id
 */
export async function forceWait(id) {
  if ( !game.user.isGM ) return false;
  const wait = playerWaits().find(w => w.id === id);
  if ( !wait ) return false;
  const actor = wait.actor ? await fromUuid(wait.actor) : null;
  const token = tokenOfActor(actor);
  if ( token ) notice(token, { key: "Attente.Avis", data: { name: wait.userName } }, "refused", { all: true, action: "forced", outcome: "success" });
  log(`${wait.userName}'s answer forced by the GM (${wait.label || wait.actorName})`);
  return forcePlayerWait(id);
}

/** Les attentes d'un personnage (menu de son token). */
export const waitsOf = actor => (actor ? playerWaits().filter(w => w.actor === actor.uuid) : []);

export function registerPlayerWaits() {
  game.settings.register(MODULE_ID, "combatWindowUnlimited", {
    name: "DND5ECOMBAT.Reglage.combatWindowUnlimited.Nom", hint: "DND5ECOMBAT.Reglage.combatWindowUnlimited.Aide",
    scope: "world", config: true, type: Boolean, default: false
  });
  CONFIG.queries[FORCE_WINDOWS_QUERY] = handleForceWindows;   // on all clients: it is the player's that closes their windows
}
