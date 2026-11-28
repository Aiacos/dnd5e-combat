/**
 * At 0 Hit Points (SPEC §17): damage at 0 HP, instant death, death saving throw at the start of the turn,
 * Stabilized and Dead. The rule is in core/death.mjs, reading and writing in adapter/death.mjs.
 */

import {
  DEATH_QUERY, handleDeathSaveQuery, planDamageAtZero, settleDamageAtZero, settleDeathSave, deathSaveDue,
  requestDeathSave, clearDeathMarks, ensureDowned
} from "../adapter/death.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { MODULE_ID } from "../constants.mjs";
import { log, loc, notice } from "./shared.mjs";

/** A creature's turn at 0 HP begins: it rolls its death saving throw. */
function onTurnChange(combat, prior, current) {
  const token = combat.combatants.get(current?.combatantId)?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  // §17.1: a creature left at 0 HP without its condition (HP written before the engine, system setting) receives it.
  if ( (actor.system?.attributes?.hp?.value ?? 1) <= 0 ) ensureDowned(actor).catch(err => console.error(err));
  if ( !deathSaveDue(actor) ) return;
  // Same queue as the triggers of this creature's turn (runtime/triggers.mjs).
  return enqueue(`turn:${token.uuid}`, async () => {
    if ( !deathSaveDue(actor) ) return;
    const who = await requestDeathSave(actor);
    log(`${actor.name}: Death Saving Throw (${who === "player" ? "the player" : "the engine"})`);
  });
}

export function registerDeath() {
  CONFIG.queries[DEATH_QUERY] = handleDeathSaveQuery;
  // On the client that applies the damage (it has the right to write the actor): the failures leave with the damage.
  route("dnd5e.preApplyDamage", planDamageAtZero, { label: "0 HP: failures not counted" });
  route("dnd5e.applyDamage", async (actor, amount, options) => {
    // §31: Relentless Endurance — the creature stays at 1 HP (adapter/species.mjs, via planDamageAtZero).
    const endured = options?.[MODULE_ID]?.endured;
    if ( endured ) {
      log(`${actor.name}: ${endured}, stays at 1 HP`);
      const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
      if ( token ) notice(token, loc("Espece.Acharnement", { item: endured }), "gain");
    }
    const outcome = await settleDamageAtZero(actor, amount, options);
    if ( outcome ) log(`${actor.name}: damage at 0 HP → ${outcome.stable ? "stabilized by the weapon" : outcome.dead ? `dead (${outcome.reason})` : `${outcome.failures} failure(s)`}`);
  }, { label: "0 HP: death or failure not applied" });
  // On the client that made the roll (the player, or the engine).
  route("dnd5e.rollDeathSaveV2", (rolls, { outcome, subject }) => settleDeathSave(subject, outcome),
    { label: "Death Saving Throw: Stable or Dead not applied" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "Death Saving Throw not requested" });
  route("updateActor", async (actor, changed) => {
    const hp = foundry.utils.getProperty(changed, "system.attributes.hp.value");
    if ( hp > 0 ) return clearDeathMarks(actor);
    // §17.1: at 0 HP, the condition is mandatory (the system only sets it in combat, and according to a setting).
    if ( (hp !== undefined) || (foundry.utils.getProperty(changed, "system.attributes.death.failure") !== undefined) ) {
      const status = await ensureDowned(actor, { afterUpdate: true });
      if ( status ) log(`${actor.name}: 0 HP → ${status === "dead" ? "Dead" : "Unconscious"}`);
    }
  }, { executor: true, label: "Dead / Unconscious / Stable not applied or not removed" });
  // An unlinked token whose HP are written in the token itself (`delta.system…`): the core does not publish
  // `updateActor` in that case (client/documents/actor-delta.mjs:219 runs only for an ActorDelta update).
  route("updateToken", async (token, changed) => {
    const hp = foundry.utils.getProperty(changed, "delta.system.attributes.hp.value");
    if ( (hp === undefined) || !token.actor ) return;
    if ( hp > 0 ) return clearDeathMarks(token.actor);
    const status = await ensureDowned(token.actor, { afterUpdate: true });
    if ( status ) log(`${token.actor.name}: 0 HP → ${status === "dead" ? "Dead" : "Unconscious"}`);
  }, { executor: true, label: "Dead / Unconscious not applied (unlinked token)" });
}
