/**
 * §355: weapons that feed their bearer. On the active GM, at the engine's exit hook `dnd5e-combat.resolution`, once the
 * resolution is closed (like runtime/felled.mjs):
 *  - `devours` (Blackrazor): a creature the weapon drops to 0 HP, neither a Construct nor an Undead, is killed (Dead) and
 *    the bearer gains Temporary Hit Points equal to their maximum HP;
 *  - `critFeeds` (Sword of Life Stealing): a Critical Hit on such a creature gives the bearer these Temporary Hit Points.
 * Temporary Hit Points do not stack: only a higher value replaces the bearer's.
 */

import { STEPS } from "../core/action.mjs";
import { weaponFeed } from "../core/defenses.mjs";
import { contentOf } from "../adapter/content.mjs";
import { creatureTypeOf } from "../adapter/facts.mjs";
import { applyStatusToToken } from "../adapter/apply-effects.mjs";
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

const seen = new Set();

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const entry = activity?.item ? contentOf(activity.item).entry : null;
  if ( !entry?.devours && !entry?.critFeeds ) return;
  seen.add(resolution.id);
  const fallen = new Set((resolution.log ?? []).filter(l => (l.at === "applyDamage") && !l.kind && (l.before?.value > 0) && (l.after?.value === 0))
    .map(l => l.token));
  const victims = (resolution.targets ?? []).map(t => {
    const actor = fromUuidSync(t.token, { strict: false })?.actor;
    return { id: t.token, type: actor ? creatureTypeOf(actor) : null, hit: t.hit === true, critical: t.critical === true,
      fell: fallen.has(t.token), maxHp: actor?.system?.attributes?.hp?.max ?? 0 };
  });
  const { tempHp, slain } = weaponFeed({ devours: entry.devours === true, critAmount: entry.critFeeds?.amount ?? 0, victims });
  const carrier = game.messages.get(resolution.carrier ?? "");
  for ( const id of slain ) {
    // At 0 HP, the engine already sets Unconscious or Dead (same effect id, `dnd5edead0000000`): one beat for it to finish, then
    // only if the creature is not already Dead — two crossed creations of the condition fail (seen on 2026-11-03).
    await new Promise(resolve => setTimeout(resolve, 600));
    if ( fromUuidSync(id, { strict: false })?.actor?.statuses?.has("dead") ) continue;
    await applyStatusToToken(carrier, id, "dead");
    log(`${activity.item.name}: ${fromUuidSync(id, { strict: false })?.name} is slain, its soul devoured`);
  }
  const wielder = activity.actor;
  const current = wielder?.system?.attributes?.hp?.temp ?? 0;
  if ( !wielder || !(tempHp > current) ) return;
  await wielder.update({ "system.attributes.hp.temp": tempHp });
  log(`${activity.item.name}: ${wielder.name} gains ${tempHp} temporary Hit Points`);
  const token = wielder.getActiveTokens?.(false, true)?.[0];
  if ( token ) notice(token, loc("Retour.PvTemporaires", { n: tempHp, item: activity.item.name }), "gain", { all: true, action: "weaponFeed" });
}

export function registerWeaponFeed() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`weapon-feed:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "weapon feeding its wielder: temporary Hit Points not given" });
}
