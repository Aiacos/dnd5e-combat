/**
 * Metamagic (SPEC §32): the chosen option (its activity, which spends the Sorcery Points) is held on the sorcerer, then
 * carried by the next spell — Quickened Spell: its cost becomes the Bonus Action (imposed cost, read by legality and spending,
 * runtime/turn.mjs); the other options are read at resolution (adapter/usage.mjs, adapter/saves.mjs), by range
 * (adapter/turn.mjs) and by the Counterspell window (runtime/gates.mjs). Registered before registerTurn.
 */

import { MODULE_ID } from "../constants.mjs";
import { metamagicKindOf, pendingMetamagic, addMetamagic, clearMetamagic, metamagicRulesOf } from "../adapter/metamagic.mjs";
import { freeOption } from "../core/metamagic-rules.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Options taken without spending (Arcane Apotheosis), for the time of their use: the activity → the turn. */
const free = new Map();

/**
 * A Metamagic option about to be held: free if Arcane Apotheosis allows it this turn. Beyond what a spell can carry (one; two
 * under Innate Sorcery), it is an issue for the legality window (runtime/turn.mjs `useIssues`,
 * `Souci.metamagicLimit`): forceable, the GM notified; forced, the option is held like the others.
 */
function onPreUseOption(activity, usageConfig) {
  const actor = activity.actor;
  const rules = metamagicRulesOf(actor);
  const turn = currentTurnKey();
  if ( freeOption(rules, { usedTurn: actor.getFlag(MODULE_ID, "metamagicFree") ?? null, turn }) ) {
    usageConfig.consume = { ...((typeof usageConfig.consume === "object") ? usageConfig.consume : {}), resources: false };
    free.set(activity.uuid, turn);
    log(`${actor.name}: ${activity.item.name} without Sorcery Points (once on each turn)`);
  }
  return true;
}

function onPreUse(activity, usageConfig) {
  const actor = activity?.actor;
  const kind = actor ? metamagicKindOf(activity) : null;
  if ( kind ) return onPreUseOption(activity, usageConfig);
  if ( (activity?.item?.type !== "spell") || !actor ) return true;
  const kinds = pendingMetamagic(actor);
  if ( !kinds.length ) return true;
  const ours = (usageConfig[MODULE_ID] ??= {});
  ours.metamagic = kinds;
  // Quickened Spell: "a spell with a casting time of 1 action".
  if ( kinds.includes("quickened") && (activity.activation?.type === "action") && !ours.cost ) ours.cost = "bonus";
  return true;
}

async function onPostUse(activity) {
  const actor = activity?.actor;
  if ( !actor?.isOwner ) return;
  const kind = metamagicKindOf(activity);
  if ( kind ) {
    if ( free.has(activity.uuid) ) {
      const turn = free.get(activity.uuid);
      free.delete(activity.uuid);
      if ( turn ) await actor.setFlag(MODULE_ID, "metamagicFree", turn);
    }
    const kinds = await addMetamagic(actor, kind);
    const token = actor.getActiveTokens?.(false, true)?.[0];
    if ( token ) notice(token, loc("Metamagie.Retenue", { item: activity.item.name }), "gain");
    log(`${actor.name}: Metamagic held for the next spell (${kinds.join(", ")})`);
    return;
  }
  if ( (activity.item?.type === "spell") && pendingMetamagic(actor).length ) {
    log(`${actor.name}: Metamagic applied to ${activity.item.name} (${pendingMetamagic(actor).join(", ")})`);
    await clearMetamagic(actor);
  }
}

export function registerMetamagic() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "metamagic: spell not modified" });
  route("dnd5e.postUseActivity", activity => onPostUse(activity), { label: "metamagic not held" });
}
