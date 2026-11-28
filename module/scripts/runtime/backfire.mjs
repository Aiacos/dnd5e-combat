/**
 * O9h (§363): an object that can turn against its bearer (`backfire: { after, chance, activity, destroys? }` — Horn of
 * Blasting: "each time you use the Magic action to blow the horn, there is a 20% chance it explodes: 10d6 Force damage
 * to the blower, and the horn is destroyed"). Active GM, at the engine's output hook `dnd5e-combat.resolution` (the action
 * decided), or, lacking a resolution (nobody in the area), a little after the use card: a d100 in the clear; `chance` or less,
 * the damage activity `activity` hits the bearer, then the object is destroyed.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

/** The use cards already judged (once per blast). */
const judged = new Set();
/** The delay left to a resolution before judging without it. */
const FALLBACK_MS = 15000;

function ruleOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.backfire : null;
  return (rule && rule.after.includes(activity.id)) ? rule : null;
}

async function judge(messageId, activity) {
  if ( !messageId || judged.has(messageId) ) return;
  judged.add(messageId);
  const rule = ruleOf(activity);
  const item = activity?.item;
  const actor = item?.actor;
  if ( !rule || !actor || !actor.items.has(item.id) ) return;
  const roll = await new Roll("1d100").evaluate();
  const blows = roll.total <= rule.chance;
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: loc(blows ? "Explosion.Explose" : "Explosion.Tient", { item: item.name, n: rule.chance }),
    flags: { [MODULE_ID]: { backfire: { item: item.name, roll: roll.total, blows } } } });
  log(`${item.name}: backfire roll ${roll.total} (${rule.chance}% or less) → ${blows ? "explodes" : "holds"}`);
  if ( !blows ) return;
  const token = tokenOf(actor);
  if ( token ) {
    await inflict({ step: { activity: rule.activity }, item, targetUuid: token.uuid,
      speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: loc("Explosion.Degats", { item: item.name, name: actor.name }),
      flags: { backfire: { item: item.name } } });
    notice(token, loc("Explosion.Explose", { item: item.name, n: rule.chance }), "refused", { all: true });
  }
  if ( rule.destroys ) {
    await item.delete();
    log(`${item.name}: destroyed`);
  }
}

function onResolution(resolution) {
  if ( resolution?.step !== STEPS.DONE ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( !ruleOf(activity) ) return;
  enqueue(`backfire:${activity.item.uuid}`, () => judge(resolution.origin ?? resolution.carrier ?? resolution.id, activity));
}

function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const activity = message.getAssociatedActivity?.();
  if ( !ruleOf(activity) ) return;
  // Without an engine resolution (nobody in the cone), the roll is made anyway, a little after.
  setTimeout(() => {
    if ( game.messages.get(message.id)?.getFlag(MODULE_ID, "resolution") ) return;   // the resolution handles it
    enqueue(`backfire:${activity.item.uuid}`, () => judge(message.id, activity));
  }, FALLBACK_MS);
}

export function registerBackfire() {
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "backfire: explosion chance not rolled" });
  route("createChatMessage", onUsage, { executor: true, label: "backfire: explosion chance not rolled" });
}
