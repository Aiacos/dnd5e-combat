/**
 * §501 (brick B21) — "if it would lose its reactions, it only loses one" (`reactions: { perRound, loseOne: true }`). The reading
 * ("can it react?") is in adapter/reactions.mjs `reactionState`; here, when an effect is applied that would remove its reactions
 * (Incapacitated, or a `noReactions` effect), the creature in combat loses ONE Reaction of the round, seen and heard by the
 * whole table. Active GM.
 */

import { costsReaction, loseReaction } from "../core/reaction-loss.mjs";
import { combatantFor, readBudget, writeBudget, losesOnlyOneReaction } from "../adapter/turn.mjs";
import { blocksReactions } from "../adapter/reactions.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, notice } from "./shared.mjs";

/** Only one Reaction lost per moment: a condition and its "riders" (Paralyzed then Incapacitated) arrive as two effects. */
const SAME_BLOW_MS = 1500;
const lastLoss = new Map();

function onEffectCreated(effect) {
  const actor = effect?.parent;
  if ( (actor?.documentName !== "Actor") || !losesOnlyOneReaction(actor) ) return;
  if ( !costsReaction({ statuses: Array.from(effect.statuses ?? []), blocks: blocksReactions(effect), actorStatuses: Array.from(actor.statuses ?? []) }) ) return;
  const combatant = combatantFor(actor);
  if ( !combatant ) return;   // out of combat, the Reaction is always there: nothing to lose
  return enqueue(`reaction-loss:${actor.uuid}`, async () => {
    const now = Date.now();
    if ( (now - (lastLoss.get(actor.uuid) ?? 0)) < SAME_BLOW_MS ) return;
    lastLoss.set(actor.uuid, now);
    const { budget, lost, left } = loseReaction(readBudget(combatant));
    if ( !lost ) { log(`${actor.name}: ${effect.name} — no Reaction left to lose`); return; }
    await writeBudget(combatant, budget);
    log(`${actor.name}: ${effect.name} — loses one Reaction instead of all (${left} left)`);
    const token = tokenOf(actor);
    if ( token ) notice(token, { key: "Reaction.PerdUne", data: { name: actor.name, n: left } }, "info", { all: true, action: "reactionLost", outcome: "failure" });
  });
}

export function registerReactionLoss() {
  route("createActiveEffect", onEffectCreated, { executor: true, label: "lose one reaction: budget not reduced" });
}
