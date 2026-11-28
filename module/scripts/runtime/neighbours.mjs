/**
 * §102: what the engine offers neighboring modules for the turn budget — knowing whether a spend is possible, and making it
 * (Darsh Loot: "Search the surroundings" costs the Search action in combat). The engine knows none of them: it is the public API
 * `api.budget`. Same pattern as the movement of an area (runtime/zones.mjs `handleMoveZone`).
 */
import { checkUse, spendUse, basicAction, BASIC_ACTION_FLAGS } from "../core/turn.mjs";
import { windowDisengaged } from "./reactions.mjs";
import { combatantFor, isOwnTurn, readBudget, writeBudget } from "../adapter/turn.mjs";
import { dropHeld } from "../adapter/orders.mjs";

const request = cost => ({ cost, weaponAttack: false, usesSpellSlot: false });

/** This actor's combatant in the started combat, or null (out of combat: nothing costs). */
function combatantOf(actor) {
  if ( !actor || !game.combat?.started ) return null;
  return combatantFor(actor) ?? null;
}

/**
 * What prevents this spend ("notYourTurn", "noAction", "noBonus", "noReaction"); empty list if it is possible,
 * or if the actor is not in combat.
 * @param {Actor} actor
 * @param {"action"|"bonus"|"reaction"} [cost="action"]
 */
export function budgetIssues(actor, cost="action") {
  const combatant = combatantOf(actor);
  if ( !combatant ) return [];
  return checkUse(readBudget(combatant), request(cost), { isOwnTurn: isOwnTurn(combatant) });
}

/**
 * Spend an action (or a Bonus Action, a Reaction) from this actor's budget, if they are in combat. To call on the active
 * GM (the budget is a combatant flag). Returns true if a spend was written.
 */
export async function spendBudget(actor, cost="action") {
  const combatant = combatantOf(actor);
  if ( !combatant ) return false;
  await writeBudget(combatant, spendUse(readBudget(combatant), request(cost), { isOwnTurn: isOwnTurn(combatant), attacksPerAction: 1 }));
  return true;
}

/** §179: the basic actions that a neighbor can have a creature without an item take (an NPC does not have the engine's). */
export const TAKEABLE_BASICS = Object.freeze(["dash", "disengage", "dodge"]);

/**
 * §179: have a creature in combat take a basic action (Dash, Disengage, Dodge), as its item would: the action spent and the turn
 * state set (doubled movement, no Opportunity Attack, Dodge); Disengage also opens the Reactions to a disengagement (Sentinel).
 * On the active GM. Returns true if done; false out of combat, out of its turn, with no action, or already taken.
 * @param {Actor} actor
 * @param {"dash"|"disengage"|"dodge"} kind
 */
export async function takeBasicAction(actor, kind) {
  if ( !TAKEABLE_BASICS.includes(kind) ) throw new Error(`basic action "${kind}" cannot be taken this way (${TAKEABLE_BASICS.join(", ")})`);
  const combatant = combatantOf(actor);
  if ( !combatant ) return false;
  const before = readBudget(combatant);
  if ( (kind !== "dash") && before[BASIC_ACTION_FLAGS[kind]] ) return false;   // §402: Dash is taken again with another action
  if ( checkUse(before, request("action"), { isOwnTurn: isOwnTurn(combatant) }).length ) return false;
  await writeBudget(combatant, basicAction(before, kind));
  if ( (kind === "disengage") && combatant.token ) windowDisengaged(combatant.token);
  return true;
}

/**
 * §180: a saving throw requested of a creature outside a resolution (a neighbor: an NPC's morale check), rolled without a
 * window, visible in chat like the saving throws of NPCs that the engine rolls. Returns `{ total, d20, dc, success }`, or null if
 * nothing was rolled. `flavor`: the card's title.
 * @param {Actor} actor
 * @param {{ ability: string, dc: number, advantage?: boolean, disadvantage?: boolean, flavor?: string }} request
 */
export async function requestSave(actor, { ability, dc, advantage=false, disadvantage=false, flavor=null }={}) {
  if ( !actor || !ability ) return null;
  const rolls = await actor.rollSavingThrow({ ability, target: dc, advantage, disadvantage }, { configure: false },
    flavor ? { data: { flavor } } : {});
  const roll = rolls?.[0];
  if ( !roll ) return null;
  return { total: roll.total, d20: roll.d20?.total ?? null, dc, success: Number.isFinite(dc) ? (roll.total >= dc) : null };
}

/**
 * §180: drop what the creature holds (like the "Drop" order of Command: on the ground if a neighbor makes a pile of it, otherwise
 * unequipped). Returns `{ items, pile, kept }` (adapter/orders.mjs `dropHeld`).
 */
export const dropHeldBy = token => dropHeld(token?.document ?? token);

