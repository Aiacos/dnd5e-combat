/**
 * §501 (brique B21) — « si elle devait perdre ses réactions, elle n'en perd qu'une » (`reactions: { perRound, loseOne: true }`). La lecture
 * (« peut-elle réagir ? ») est dans adapter/reactions.mjs `reactionState` ; ici, à la pose d'un effet qui retirerait ses réactions
 * (Neutralisé, ou un effet `noReactions`), la créature en combat perd UNE réaction du round, vue et entendue de toute la table. MJ actif.
 */

import { costsReaction, loseReaction } from "../core/reaction-loss.mjs";
import { combatantFor, readBudget, writeBudget, losesOnlyOneReaction } from "../adapter/turn.mjs";
import { blocksReactions } from "../adapter/reactions.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, notice } from "./shared.mjs";

/** Une seule réaction perdue par moment : un état et ses « riders » (Paralysé puis Neutralisé) arrivent en deux effets. */
const SAME_BLOW_MS = 1500;
const lastLoss = new Map();

function onEffectCreated(effect) {
  const actor = effect?.parent;
  if ( (actor?.documentName !== "Actor") || !losesOnlyOneReaction(actor) ) return;
  if ( !costsReaction({ statuses: Array.from(effect.statuses ?? []), blocks: blocksReactions(effect), actorStatuses: Array.from(actor.statuses ?? []) }) ) return;
  const combatant = combatantFor(actor);
  if ( !combatant ) return;   // hors combat, la réaction est toujours là : rien à perdre
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
