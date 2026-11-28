/**
 * §373: after a hit, activities offered for free against the target (content `hitFollowUp`) — Crusher: Grapple or
 * Shove of the Unarmed Strike in addition to damage; "Low Blow": both. On the active GM, once the attack is resolved: the
 * question to the author's player (`askChoice`), then each chosen activity played against the target still standing
 * (`strikeAgainst`: the save and its effects, like a "Mischievous Strike"), one after another. Apart from the boons window
 * (only one per hit): a boon ("School of Hard Knocks") and a grapple stack.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { weaponKind } from "../adapter/facts.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc } from "./shared.mjs";

const seen = new Set();

/**
 * What the author can chain after a hit of this activity: the union of the activities of their `hitFollowUp` items that
 * apply to this kind of weapon, and the greatest number to take. `{ activities, choose }`, or null.
 */
export function followUpsFor(actor, activity) {
  const kind = weaponKind(activity);
  const activities = new Map();
  let choose = 0;
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.hitFollowUp;
    if ( !rule || (rule.weapons && !rule.weapons.includes(kind)) ) continue;
    let found = 0;
    for ( const { item: id, activity: activityId } of rule.use ) {
      const owner = actor.items.find(i => identifierOf(i).id === id);
      const own = owner?.system.activities?.get(activityId);
      if ( own ) { activities.set(own.uuid, own); found++; }
    }
    if ( found ) choose = Math.max(choose, rule.choose ?? 1);
  }
  return activities.size ? { activities: [...activities.values()], choose: Math.min(choose, activities.size) } : null;
}

/** The possible answers: each activity alone, then combinations up to `choose`, from shortest to longest. */
export function followUpCombos(list, choose) {
  const out = [];
  const walk = (start, picked) => {
    if ( picked.length ) out.push(picked);
    if ( picked.length === choose ) return;
    for ( let i = start; i < list.length; i++ ) walk(i + 1, [...picked, list[i]]);
  };
  walk(0, []);
  return out.sort((a, b) => a.length - b.length);
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const targets = resolution.targets ?? [];
  if ( (targets.length !== 1) || (targets[0].hit !== true) ) return;
  seen.add(resolution.id);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const actor = activity?.actor;
  const target = fromUuidSync(targets[0].token ?? "", { strict: false });
  const standing = () => (target?.actor?.system.attributes?.hp?.value ?? 0) > 0;
  if ( !actor || !standing() ) return;
  const offer = followUpsFor(actor, activity);
  const source = offer ? (actor.getActiveTokens(false, true)[0] ?? null) : null;
  if ( !source ) return;
  const choices = followUpCombos(offer.activities, offer.choose);
  const label = list => list.map(a => a.name || a.item.name).join(loc("Suite.Et"));
  const answer = await askChoice(actor, { actor: actor.uuid, item: activity.item?.name ?? "", prompt: loc("Suite.Question", { name: target.name }),
    // "Nothing more" first: it is the default answer of a window left unanswered (askChoice takes the first).
    options: [{ id: "none", label: loc("Suite.Aucune") }, ...choices.map((list, i) => ({ id: `c${i}`, label: label(list) }))] });
  const picked = String(answer?.id ?? "").startsWith("c") ? choices[Number(answer.id.slice(1))] : null;
  if ( !picked ) return;
  for ( const own of picked ) {
    if ( !standing() ) break;
    log(`${actor.name}: ${own.name || own.item.name} after the hit on ${target.name}`);
    await strikeAgainst(own, source, target, { flavor: "DND5ECOMBAT.Suite.Carte" });
  }
}

export function registerFollowUps() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`follow-up:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "hit follow-up not offered" });
}
