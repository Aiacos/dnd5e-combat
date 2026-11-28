/**
 * Spell defenses in play (SPEC §16.46). Resistance: in the engine's damage application (adapter/messages.mjs,
 * runtime/engine.mjs). Arcane Vigor: the "spend these Hit Dice" intent (ui/vigor.mjs window).
 */

import { spendHitDiceToHeal } from "../adapter/defenses.mjs";
import { log } from "./shared.mjs";

/** §16.46: "spend `count` Hit Dice `die` to heal" intent. */
export async function healWithHitDice(activity, die, count) {
  const roll = await spendHitDiceToHeal(activity, die, count);
  if ( roll ) log(`${activity.actor.name}: ${activity.item.name}, ${count}${die} → ${roll.total} HP`);
  return roll;
}

export function registerDefenses() {
  // Nothing to hook up: the reduction goes through the engine's damage application (§16.46).
}
