/**
 * §36: Diviner's Portent. The noted rolls are made at the Long Rest; the question "replace this d20?" is asked by the attack
 * gate (runtime/gates.mjs) and by the saving throw request (adapter/saves.mjs); the roll bounded by runtime/conditions.mjs and
 * adapter/saves.mjs. Here: the Long Rest, and the query that the diviner's client answers.
 */

import { PORTENT_QUERY, PORTENT_SETTING, handlePortentQuery, portentDice, rollPortent } from "../adapter/portent.mjs";
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/**
 * `dnd5e.restCompleted` only fires on the client that started the rest (documents/actor/actor.mjs:2421): no `executor`,
 * it is that client, the actor's owner, that rolls and notes the d20s.
 */
async function onRestCompleted(actor, result, config) {
  if ( (config?.type !== "long") || !actor?.isOwner || !portentDice(actor) ) return;
  const rolls = await rollPortent(actor);
  if ( rolls ) log(`${actor.name}: Portent, rolls noted ${rolls.join(", ")}`);
}

export function registerPortent() {
  // §38.4: disabled, the engine no longer offers Portent (no question, no suspended attack); the d20s are still rolled and
  // noted at the Long Rest, to play it by hand.
  game.settings.register(MODULE_ID, PORTENT_SETTING, {
    name: "DND5ECOMBAT.Reglage.portent.Nom",
    hint: "DND5ECOMBAT.Reglage.portent.Aide",
    scope: "world", config: true, type: Boolean, default: true
  });
  // On all clients: it is the diviner's (their player, or the GM) that answers.
  CONFIG.queries[PORTENT_QUERY] = handlePortentQuery;
  route("dnd5e.restCompleted", onRestCompleted, { label: "Portent not rolled on Long Rest" });
}
