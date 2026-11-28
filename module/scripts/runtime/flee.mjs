/**
 * §147: fleeing through the Reaction (Dissonant Whispers: "on a failed save, it must immediately use its Reaction, if available,
 * to move away from you as far as its Speed allows"). Active GM, at closed resolution (`dnd5e-combat.resolution`, DONE):
 * each target that failed its save, alive, not Incapacitated, Reaction available, spends it and moves away from the caster via the
 * engine's A* — to the greatest gap its Speed reaches (`fleeGaps`: from farthest to nearest, the first reachable). It is a
 * real movement: it provokes Opportunity Attacks (`walkToGap` → `walkSafely`). The "safest path" is left to the GM.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { fleeGaps } from "../core/flee.mjs";
import { reactionAvailable } from "../core/turn.mjs";
import { contentOf } from "../adapter/content.mjs";
import { combatantFor, readBudget, writeBudget, currentTurnKey, speedOf, historyCosts } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { walkToGap, gapBetween } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

const handled = new Set();
const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"];

async function flee(token, caster, item) {
  const actor = token.actor;
  if ( !actor || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  if ( INCAPACITATING.some(s => actor.statuses?.has(s)) ) return;
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget && !reactionAvailable(budget, currentTurnKey()) ) {
    log(`${item.name}: ${token.name} has no Reaction left — does not flee`);
    return;
  }
  const speed = speedOf(actor, readUnitFactors(), token._source?.movementAction ?? null, token.parent)?.speed ?? 0;   // §229 : en vol, la vitesse de vol
  const cells = Math.floor(speed / (token.parent.grid.distance || 5));
  if ( cells <= 0 ) return;
  if ( budget ) await writeBudget(combatant, { ...budget, reaction: Math.max(0, (budget.reaction ?? 1) - 1), reactedAt: currentTurnKey() });
  notice(token, loc("Fuite.Retour"), "reaction");
  // The Reaction gives the full Speed, outside the turn's budget: the cap is counted from the core's history as it stands.
  const history = historyCosts(token);
  const maxCost = history.spent + history.excluded + speed;
  const from = gapBetween(token, caster);
  for ( const gap of fleeGaps(from, cells) ) {
    if ( await walkToGap(token, caster, gap, { maxCost }) ) {
      log(`${item.name}: ${token.name} flees from ${caster.name} with its Reaction (${from} → ${gap} squares)`);
      return;
    }
    // A step may have been taken without reaching the targeted gap (wall, Opportunity Attack): we do not set off again.
    if ( gapBetween(token, caster) !== from ) return;
  }
  log(`${item.name}: ${token.name} cannot get further from ${caster.name}`);
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || handled.has(resolution.origin) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const item = activity?.item;
  if ( !item || (contentOf(item).entry?.fleeOnFailedSave !== true) ) return;
  handled.add(resolution.origin);
  const usage = game.messages.get(resolution.origin);
  const sp = usage?.speaker ?? {};
  const caster = (sp.scene && sp.token) ? game.scenes.get(sp.scene)?.tokens.get(sp.token) : null;
  if ( !caster ) return;
  for ( const t of (resolution.targets ?? []).filter(x => x.save && !x.save.success) ) {
    const token = await fromUuid(t.token);
    if ( token && (token !== caster) ) await flee(token, caster, item);
  }
}

export function registerFlee() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`flee:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "Dissonant Whispers: flight not played" });
}
