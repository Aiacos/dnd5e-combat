/**
 * §95: Wails from the Grave (Phantom, key `afterSneak: { activity, radius, units }`) — "immediately after you deal the damage
 * of your Sneak Attack to a creature on your turn, you can target a second creature you can see within 9 m of the first;
 * roll half the Sneak Attack dice (rounded up), Necrotic damage". On the active GM, when resolving the
 * hit whose damage roll carries the Sneak Attack mark (runtime/sneak.mjs): the question to the author ("None" first),
 * then the item's activity (its dice: `ceil(@scale.rogue.sneak-attack.number / 2)` from the data) used on the chosen creature
 * — a use of the item spent by dnd5e.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { usesLeftFor } from "../adapter/inspiration.mjs";
import { combatantFor, distanceBetween, isOwnTurn } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { lengthIn } from "../adapter/units.mjs";

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.damageRoll?.messageId ) return;
  const sneak = game.messages.get(resolution.damageRoll.messageId)?.getFlag(MODULE_ID, "sneak");
  if ( !sneak ) return;
  const source = fromUuidSync(sneak.source ?? "", { strict: false });
  const first = fromUuidSync(sneak.target ?? "", { strict: false });
  const actor = source?.actor;
  if ( !actor || !first?.parent ) return;
  const combatant = combatantFor(actor);
  if ( combatant && !isOwnTurn(combatant) ) return;   // "on your turn"
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.afterSneak;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    let reach = lengthIn(rule.radius, rule.units, first.parent.grid.units);
    const candidates = first.parent.tokens.filter(t => t.actor && (t !== first) && (t !== source) && !t.hidden
      && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && (distanceBetween(first, t).value <= (reach + 1e-6)));
    if ( !candidates.length ) return;
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, prompt: loc("Lamentations.Question", { item: item.name, name: first.name }),
      options: [{ id: "no", label: loc("Balayage.Non") }, ...candidates.map(t => ({ id: t.uuid, label: t.name }))]
    });
    const victim = candidates.find(t => t.uuid === answer?.id);
    if ( !victim ) return;
    if ( victim.object ) canvas.tokens.setTargets([victim.id]);
    log(`${item.name}: ${victim.name}, ${Math.round(distanceBetween(first, victim).value)} from ${first.name}`);
    await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false })
      .catch(err => console.error(`${MODULE_ID} | ${item.name}`, err));
    return;
  }
}

export function registerAfterSneak() {
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "Wails from the Grave not offered" });
}
