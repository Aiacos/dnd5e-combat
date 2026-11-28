/**
 * Bursts (SPEC §16.19, key `burst`): once the attack is decided — hit or miss —, the sibling activity that the item declares
 * plays on the target and on each creature within `radius` of it (the Ice Knife explosion). On the active GM, at the engine's
 * output hook `dnd5e-combat.resolution` (runtime/engine.mjs); only once per attack.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { distanceBetween, speakerTokenOf } from "../adapter/turn.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { burstAround } from "../adapter/areas.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { lengthIn } from "../adapter/units.mjs";

/**
 * The creatures hit by the burst: the target, and any creature within `radius` of it (neither hidden, nor a driven object).
 * C12-b: `affects: "enemy"` — only the caster's enemies, the target excluded ("Life Shock": lightning springs from the
 * revived creature).
 */
function caughtAround(center, { radius, units, affects=null }, caster=null) {
  let limit = lengthIn(radius, units, center.parent.grid.units);
  const all = center.parent.tokens.filter(t => (t === center) || (t.actor && !t.hidden && !isObjectToken(t)
    && (t._source.level === center._source.level) && (distanceBetween(center, t).value <= limit + 1e-6)));
  return (affects === "enemy") ? all.filter(t => (t !== center) && caster && areEnemies(caster, t)) : all;
}

async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) ) return;
  const usage = game.messages.get(resolution.origin);
  if ( !usage || usage.getFlag(MODULE_ID, "burst") || usage.getFlag(MODULE_ID, "areaTick") ) return;
  const activity = fromUuidSync(resolution.activity, { strict: false });
  const rule = activity?.item ? contentOf(activity.item).entry?.burst : null;
  if ( !rule ) return;
  // Without `from`: after an attack, hit or miss. With: after those activities, on a target that took damage.
  // C12-b: after a healing ("Life Shock"), with no damage condition.
  const afterHeal = activity.type === "heal";
  if ( rule.from ? !rule.from.includes(activity.id) || (!afterHeal && !((resolution.targets?.[0]?.damage?.applied ?? 0) > 0)) : !resolution.plan?.attack ) return;
  // §403: a healing on a target it cannot affect ("Life Shock" on a standing or dead creature) triggers nothing.
  if ( afterHeal && resolution.targets?.[0]?.unaffected ) return;
  const sibling = rule ? activity.item.system.activities?.get(rule.activity) : null;
  const center = resolution.targets?.[0]?.token ? fromUuidSync(resolution.targets[0].token, { strict: false }) : null;
  if ( !sibling || !center ) return;
  await usage.setFlag(MODULE_ID, "burst", true);
  const caught = caughtAround(center, rule, speakerTokenOf(usage));
  if ( !caught.length ) { log(`${activity.item.name}: no creature caught by the burst`); return; }
  log(`${activity.item.name}: ${resolution.step === STEPS.MISSED ? "miss" : "hit"}, the burst explodes on ${caught.map(t => t.name).join(", ")}`);
  await burstAround(usage, caught, sibling, center);
}

export function registerBursts() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`burst:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "burst: explosion not played" });
}
