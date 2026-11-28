/**
 * Consecutive turns (`extraTurns`, core/extra-turns.mjs): Time Stop. On use, in combat, the number of turns is rolled
 * (visible roll) and noted on the caster; at the end of each of their turns, while any remain, the active GM brings the
 * combat back to them. What ends it early ("if one of your actions affects another creature") is left to the GM: removing
 * the flag, or passing the turn by hand backward then forward, is not necessary — a tracker rewind consumes nothing.
 */

import { MODULE_ID } from "../constants.mjs";
import { takesAnotherTurn, movedForward } from "../core/extra-turns.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const FLAG = "extraTurns";

async function onPostUse(activity, usageConfig, results) {
  const rule = activity?.item ? contentOf(activity.item).entry?.extraTurns : null;
  const actor = activity?.actor;
  const combat = game.combat;
  if ( !rule || !results?.message || !actor || !combat?.started ) return;
  if ( !combat.combatants.some(c => c.actorId === actor.id) ) return;
  // The formula is the rule's ("1d4 + 1"), with no activity data: nothing to scale to the casting level.
  const roll = await new Roll(rule.formula).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc("ToursAffilee.Jet", { item: activity.item.name, n: roll.total }) });
  await actor.setFlag(MODULE_ID, FLAG, { combat: combat.id, left: roll.total, item: activity.item.name });
  log(`${activity.item.name}: ${actor.name} takes ${roll.total} turns in a row`);
}

async function onTurnChange(combat, prior, current) {
  const ended = combat.combatants.get(prior?.combatantId);
  const actor = ended?.actor;
  const state = actor?.getFlag(MODULE_ID, FLAG) ?? null;
  if ( !takesAnotherTurn(state, { combat: combat.id, forward: movedForward(prior, current) }) ) {
    // A flag from another combat, or spent: we remove it when its bearer ends a turn.
    if ( state && ((state.combat !== combat.id) || !(state.left > 0)) ) await actor.unsetFlag(MODULE_ID, FLAG);
    return;
  }
  const left = state.left - 1;
  if ( left > 0 ) await actor.setFlag(MODULE_ID, FLAG, { ...state, left });
  else await actor.unsetFlag(MODULE_ID, FLAG);
  await combat.update({ round: prior.round, turn: prior.turn });
  log(`${state.item}: ${actor.name} takes another turn (${left} left)`);
}

export function registerExtraTurns() {
  route("dnd5e.postUseActivity", onPostUse, { label: "turns in a row: number not rolled" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "turns in a row: turn not given back" });
}
