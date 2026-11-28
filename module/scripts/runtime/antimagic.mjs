/**
 * §436: dnd5e 6.1's antimagic held to the end.
 *  - The Player's Handbook's Antimagic Field does not have the SRD 6.1 `antimagic` activity behavior: when the region of
 *    its template is created (active GM), the engine adds the system's `dnd5e.antimagic` region behavior to it — dnd5e
 *    then sets the `antimagic` status on whoever enters, removes it on exit, and the region follows the caster. Only for an
 *    item whose content declares `antimagicZone` (content/antimagic.mjs: Antimagic Field, Antimagic Cone), and if dnd5e
 *    knows this behavior (6.1 and later).
 *  - The `system.magical` mark that dnd5e's migration puts on the effects of a spell, a scroll or an `mgc` item
 *    (`_migrateEffectMagical`): on a magic item added to an actor, and on an effect put on an actor from such an item. Without
 *    it, `ActiveEffect5e#isSuppressed` does not suspend the effect in a field.
 * The rest reads the status: legality (runtime/turn.mjs), eligibility (adapter/eligibility.mjs),
 * teleportation (runtime/teleport.mjs).
 */

import { ANTIMAGIC_BEHAVIOR, ANTIMAGIC_STATUS } from "../core/antimagic.mjs";
import { contentOf } from "../adapter/content.mjs";
import { antimagicBehaviorKnown, regionHasAntimagic, markItemEffects, markAppliedEffect, antimagicSourceName, antimagicBlocks,
  antimagicBlockedActivities } from "../adapter/antimagic.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";
import { MODULE_ID } from "../constants.mjs";
import { askAnyway } from "./turn.mjs";
import { overriddenFlag } from "./forced.mjs";

/** The region of an Antimagic Field without the system's behavior: give it one. */
async function onRegionCreated(region) {
  const itemUuid = region.getFlag?.("dnd5e", "item");
  if ( !itemUuid || !antimagicBehaviorKnown() ) return;
  const item = fromUuidSync(itemUuid, { strict: false });
  if ( !item || (contentOf(item).entry?.antimagicZone !== true) ) return;
  const activityUuid = region.getFlag("dnd5e", "activity");
  const activity = activityUuid ? fromUuidSync(activityUuid, { strict: false }) : null;
  await markTurnEnd(region, item);
  if ( regionHasAntimagic(region, activity) ) return;
  await region.createEmbeddedDocuments("RegionBehavior", [{ type: ANTIMAGIC_BEHAVIOR, name: item.name }]);
  log(`${item.name}: antimagic region behavior added (${region.name})`);
}

/**
 * The Antimagic Cone lasts "until the start of the next turn" of the beholder (`zoneLasts`: 6 s, the duration out of combat). In
 * combat, world time advances at the round change, before its turn if it does not play first: the zone notes its combatant and
 * the round, and ends at the start of its next turn (`onTurnChange`); `expiredRegions` (adapter/areas.mjs) waits for it as long
 * as that combat exists.
 */
async function markTurnEnd(region, item) {
  if ( !contentOf(item).entry?.zoneLasts ) return;
  const combat = game.combat;
  if ( !combat?.started ) return;
  const actor = item.actor;
  const combatant = combat.combatants.find(c => (c.actor === actor) || (c.token?.actor === actor));
  if ( !combatant ) return;
  await region.setFlag(MODULE_ID, "endsOnTurn", { combat: combat.id, combatant: combatant.id, round: combat.round });
  log(`${item.name}: ends at the start of ${combatant.name}'s next turn`);
}

/** Start of a turn: this combatant's antimagic zones placed in an earlier round end. */
async function onTurnChange(combat, prior, current) {
  const id = current?.combatantId;
  if ( !id ) return;
  for ( const region of Array.from(combat.scene?.regions ?? []) ) {
    const turn = region.getFlag(MODULE_ID, "endsOnTurn");
    if ( !turn || (turn.combat !== combat.id) || (turn.combatant !== id) || !(combat.round > turn.round) ) continue;
    const name = region.name;
    await region.delete();
    log(`area "${name}": start of ${combat.combatants.get(id)?.name ?? "?"}'s turn, removed`);
  }
}

/**
 * Force a use that dnd5e flatly refuses under the status: dnd5e 6.1 puts `visibility.requireMagic` on every spell activity
 * (dnd5e.mjs:21923, :23234) and hides an activity that requires it when `magicAvailable` is false (:18849) — `use()` then
 * stops on "Using this activity isn't currently possible" (:18914), before any hook. Suite rule: a refusal is forceable. Here,
 * before calling `use`, the engine's legality window (`askAnyway`: alert to the GM, "Forced" seen by all); forced, the status's
 * effects are disabled for the duration of the use then restored, and the card is marked `overridden`. `use(extra)` receives the
 * keys to merge into the engine's configuration. Outside this case, `use({})` as is.
 * §448: a relaunch of an already forced use (`forced`, group aim after the window) does not ask again: the field is lifted.
 * @param {Activity} activity
 * @param {(extra: object) => Promise<any>} use
 * @param {object} [options]
 * @param {boolean} [options.forced]  The relaunched use was already forced (`antimagicForced` in its configuration).
 */
export async function useDespiteAntimagic(activity, use, { forced=false }={}) {
  const actor = activity?.actor;
  if ( !antimagicBlocks(activity) ) return use({});
  if ( forced ) return withAntimagicLifted(actor, activity.item, () => use({}));
  const item = activity.item;
  const token = usageTokenOf(activity);
  const line = loc(isSpellCast(item) ? "Souci.antimagic" : "Souci.antimagicItem", { item: antimagicSourceName(actor), use: item.name });
  const go = await askAnyway(`${item.name} — ${token?.name ?? actor.name}`, [line], { actor, item, token });
  if ( !go ) return null;
  return withAntimagicLifted(actor, item, () => use({ antimagicForced: true, overridden: overriddenFlag([line]) }));
}

/**
 * The effects of the actor's antimagic status disabled for the duration of `run`, then restored: dnd5e then accepts the
 * activity (`canUse`). Also for the relaunch of legality (runtime/turn.mjs) when another reason overrode after the field:
 * without this, the relaunch would hit dnd5e's refusal, with no card (seen on the test bench on 2026-11-14: Fire Bolt
 * with no target designated).
 */
export async function withAntimagicLifted(actor, item, run) {
  const lifted = (actor?.effects ?? []).filter(e => e.statuses?.has(ANTIMAGIC_STATUS) && !e.disabled).map(e => e.id);
  if ( lifted.length ) {
    await actor.updateEmbeddedDocuments("ActiveEffect", lifted.map(_id => ({ _id, disabled: true })));
    log(`${actor.name}: antimagic lifted for ${item?.name ?? "?"} (forced)`);
  }
  try {
    return await run();
  } finally {
    const still = lifted.filter(id => actor.effects.get(id));   // left the field in the meantime: dnd5e removed the effect
    if ( still.length ) await actor.updateEmbeddedDocuments("ActiveEffect", still.map(_id => ({ _id, disabled: false })));
  }
}

/**
 * `api.antimagic.use(subject, usage, dialog, message)`: use an item or an activity like dnd5e (`item.use` / `activity.use`, same
 * arguments), but a spell or magical ability that only the field refuses goes through the "do it anyway" window
 * (`useDespiteAntimagic`). For the Combat UI bar, which calls `activity.use` directly — dnd5e stops before any hook. An item
 * one of whose activities remains allowed follows dnd5e (its activity choice); otherwise, the first activity that only the
 * field refuses.
 * @param {Item|Activity} subject
 */
export async function useAntimagic(subject, usage={}, dialog={}, message={}) {
  const isActivity = !!subject?.item && (subject.documentName !== "Item");
  const item = isActivity ? subject.item : subject;
  if ( !item ) return null;
  let activity = isActivity ? subject : null;
  if ( !activity ) {
    const usable = Array.from(item.system?.activities ?? []).some(a => a.canUse);
    activity = usable ? null : (antimagicBlockedActivities(item)[0] ?? null);
    if ( !activity ) return item.use(usage, dialog, message);
  }
  return useDespiteAntimagic(activity, extra => activity.use(
    foundry.utils.isEmpty(extra) ? usage : { ...usage, [MODULE_ID]: { ...(usage?.[MODULE_ID] ?? {}), ...extra } }, dialog, message));
}

/** The marker of an item card that the player wanted as it is (forcing refused): let it through. */
const PLAIN_CARD = "antimagicPlainCard";

/**
 * From the sheet (and any `item.use` with no allowed activity): dnd5e, finding no usable activity, displays the item's card
 * (`Item5e#use` → `displayCard`, dnd5e.mjs:36020). If an activity is refused only by the field, the "do it anyway" window in
 * its place; refused, the card goes out as dnd5e would have shown it. "Display card" in the sheet's menu also goes through here
 * (dnd5e does not tell them apart): the refusal returns the same card.
 */
function onPreDisplayCard(item, message) {
  if ( !item?.actor || message?.[MODULE_ID]?.[PLAIN_CARD] ) return true;
  if ( Array.from(item.system?.activities ?? []).some(a => a.canUse) ) return true;
  const activity = antimagicBlockedActivities(item)[0];
  if ( !activity ) return true;
  (async () => {
    const used = await useDespiteAntimagic(activity, extra => activity.use({ [MODULE_ID]: extra }));
    if ( used === null ) await item.displayCard({ [MODULE_ID]: { [PLAIN_CARD]: true } });
  })().catch(err => console.error(`${MODULE_ID} | antimagic: forced use from the sheet failed`, err));
  return false;
}

export const antimagicApi = Object.freeze({
  use: useAntimagic,
  /** Is this activity refused only by the field (so forceable)? */
  blocks: activity => antimagicBlocks(activity)
});

export function registerAntimagic() {
  route("createRegion", region => onRegionCreated(region), { executor: true, label: "antimagic: region behavior not added" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "antimagic: cone not ended" });
  route("dnd5e.preDisplayCardV2", onPreDisplayCard, { cancellable: true, label: "antimagic: forcing from the sheet not offered" });
  route("preCreateItem", item => {
    const n = markItemEffects(item);
    if ( n ) log(`${item.name}: ${n} effect(s) marked magical`);
  }, { label: "antimagic: item effects not marked magical" });
  route("preCreateActiveEffect", effect => {
    if ( markAppliedEffect(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} marked magical`);
  }, { label: "antimagic: applied effect not marked magical" });
}
