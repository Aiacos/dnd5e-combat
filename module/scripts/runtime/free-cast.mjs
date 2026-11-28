/**
 * A spell cast "in the same action", without a spell slot (key `freeCast`: Divine Intervention). The feature's activity, which
 * costs the action and the use, holds the cast on the caster (`flags["dnd5e-combat"].freeCast`); the next fitting spell goes
 * off without a slot and without an action cost (core/free-cast.mjs), then the hold is forgotten. Material components are not
 * checked by the engine: nothing to lift. Registered before registerTurn, like Metamagic.
 */

import { MODULE_ID } from "../constants.mjs";
import { freeCastApplies, freeCastHeld } from "../core/free-cast.mjs";
import { contentOf } from "../adapter/content.mjs";
import { currentTurnKey } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const ruleOf = activity => {
  const rule = activity?.item ? contentOf(activity.item).entry?.freeCast : null;
  return (rule && (rule.activity === activity.id)) ? rule : null;
};

/** The free cast this actor still holds, with its rule, or null. */
function heldBy(actor) {
  const held = actor?.getFlag?.(MODULE_ID, "freeCast");
  if ( !freeCastHeld(held, { turn: currentTurnKey(), now: game.time?.worldTime ?? 0 }) ) return null;
  const item = actor.items.get(held.item);
  const rule = item ? contentOf(item).entry?.freeCast : null;
  return rule ? { rule, item } : null;
}

const spellFacts = activity => ({ isSpell: activity.item?.type === "spell", level: Number(activity.item?.system?.level) || 0,
  activation: activity.activation?.type ?? null, sourceClass: activity.item?.system?.sourceClass || null });

function onPreUse(activity, usageConfig) {
  const actor = activity?.actor;
  const held = actor ? heldBy(actor) : null;
  if ( !held || !freeCastApplies(held.rule, spellFacts(activity)) ) return true;
  const ours = (usageConfig[MODULE_ID] ??= {});
  ours.freeCast = held.item.id;
  if ( !ours.cost ) ours.cost = "free";
  usageConfig.consume = { ...((typeof usageConfig.consume === "object") ? usageConfig.consume : {}), spellSlot: false };
  log(`${actor.name}: ${activity.item.name} cast through ${held.item.name}, no slot, same action`);
  return true;
}

async function onPostUse(activity, usageConfig) {
  const actor = activity?.actor;
  if ( !actor?.isOwner ) return;
  const rule = ruleOf(activity);
  if ( rule ) {
    await actor.setFlag(MODULE_ID, "freeCast", { item: activity.item.id, turn: currentTurnKey(), at: game.time?.worldTime ?? 0 });
    const token = actor.getActiveTokens?.(false, true)?.[0];
    if ( token ) notice(token, loc("LancementGratuit.Retenu", { item: activity.item.name }), "gain");
    log(`${actor.name}: ${activity.item.name}, the next spell of level ${rule.maxLevel} or lower is cast without a slot`);
    return;
  }
  if ( usageConfig?.[MODULE_ID]?.freeCast && actor.getFlag(MODULE_ID, "freeCast") ) await actor.unsetFlag(MODULE_ID, "freeCast");
}

export function registerFreeCast() {
  route("dnd5e.preUseActivity", onPreUse, { cancellable: true, label: "free cast: spell not modified" });
  route("dnd5e.postUseActivity", (activity, usageConfig) => onPostUse(activity, usageConfig), { label: "free cast not held" });
}
