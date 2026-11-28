/**
 * Felled enemy (SPEC §16.25, key `onFell`): Dark One's Blessing. On the active GM, at the engine's output hook
 * `dnd5e-combat.resolution`, once the resolution is closed: each target that went from more than 0 to 0 HP. Each creature in the
 * scene that carries an `onFell` item and is hostile to it benefits if it is the one that made it fall, or if it is within
 * `radius` of the victim: the item's activity plays (Temporary Hit Points, which dnd5e does not stack).
 * Limit: damage applied outside the engine (the system's board, the token bar) is not seen.
 */

import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { lengthIn } from "../adapter/units.mjs";

const seen = new Set();

/** The actor's `onFell` item and its rule — only one per creature (a sheet may carry two copies of it). */
function fellRuleOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.onFell;
    if ( rule ) return { item, rule };
  }
  return null;
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || seen.has(resolution.id) ) return;
  const fallen = (resolution.log ?? []).filter(l => (l.at === "applyDamage") && !l.kind && (l.before?.value > 0) && (l.after?.value === 0));
  if ( !fallen.length ) return;
  seen.add(resolution.id);
  for ( const entry of fallen ) {
    const victim = fromUuidSync(entry.token, { strict: false });
    if ( !victim?.parent ) continue;
    for ( const token of victim.parent.tokens ) {
      if ( (token === victim) || !token.actor || isObjectToken(token) || ((token.actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
      const found = fellRuleOf(token.actor);
      if ( !found || !areEnemies(token, victim) ) continue;
      const mine = !!resolution.source && (token.actor.uuid === resolution.source);
      let limit = lengthIn(found.rule.radius, found.rule.units, victim.parent.grid.units);
      if ( !mine && !(distanceBetween(token, victim).value <= limit + 1e-6) ) continue;
      const activities = found.item.system.activities;
      const activity = activities?.get(found.rule.activity ?? "") ?? activities?.find(a => a.type === "heal");
      if ( !activity ) continue;
      log(`${found.item.name}: ${victim.name} falls ${mine ? "to the blows of" : "near"} ${token.name}`);
      // The heal is rolled here, without a window: dnd5e's chained action (heal.mjs:60) would open the roll window on the
      // GM's side, for lack of an event. Attached to its card (`system.origin`), it follows the engine's common path.
      const used = await activity.use({ subsequentActions: false, [MODULE_ID]: { confirmed: true } }, { configure: false },
        { data: { speaker: ChatMessage.getSpeaker({ token }) } });
      if ( used?.message ) await activity.rollDamage({}, { configure: false }, { data: { system: { origin: used.message.id } } });
    }
  }
}

export function registerFelled() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`felled:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "felled enemy: blessing not played" });
}
