/**
 * Wild Shape in operation (SPEC §16.39): the druid chooses a known form (ui/wildshape.mjs), the activity is used
 * (Wild Shape use, Bonus Action, card), then the active GM transforms them; the form ends through the Bonus Action
 * "Resume Form", at the end of its duration, or when the druid is Incapacitated or drops to 0 HP.
 */

import { MODULE_ID } from "../constants.mjs";
import { needsCheck } from "../core/requests.mjs";
import { isWildShape, transformActor, revertForm, isWildShaped, formShouldEnd, expiredForms, knownForms, formInfo, formRefusedBy } from "../adapter/wildshape.mjs";
import { route } from "./router.mjs";
import { log, viaActiveGM } from "./shared.mjs";
import { relaunchUse } from "./relaunch.mjs";

export const TRANSFORM_QUERY = `${MODULE_ID}.transform`;
export const REVERT_QUERY = `${MODULE_ID}.revertForm`;

/** Active GM side: transform the actor, for a player who owns it. */
async function handleTransform({ actor: actorUuid, source: sourceUuid, activity: activityUuid }, { user }={}) {
  const actor = await fromUuid(actorUuid);
  const source = await fromUuid(sourceUuid);
  const activity = await fromUuid(activityUuid);
  if ( !actor || !source || !activity || (user && !actor.testUserPermission(user, "OWNER")) ) return false;
  // §472: from a player, the Wild Shape activity is the actor's, the form one of its known forms, and its profile allows it.
  if ( needsCheck(user) ) {
    const info = await formInfo(sourceUuid);
    if ( !isWildShape(activity) || (activity.actor?.uuid !== actor.uuid) || !knownForms(actor).forms.includes(sourceUuid)
      || !info || formRefusedBy(activity, info) ) {
      console.warn(`${MODULE_ID} | transform query from ${user.name} refused: ${source.name} is not a form ${actor.name} may take`);
      return false;
    }
  }
  const shaped = await transformActor(actor, source, activity);
  if ( shaped ) log(`${actor.name} takes the form of ${source.name}`);
  return !!shaped;
}

/** Returns in progress: at 0 HP, the Unconscious condition arrives at once — two triggers, a single return. */
const reverting = new Set();

/** Active GM side: return to the original form. */
async function handleRevert({ actor: actorUuid, reason=null }, { user }={}) {
  if ( reverting.has(actorUuid) ) return false;
  const actor = await fromUuid(actorUuid);
  if ( !actor?.isPolymorphed || (user && !actor.testUserPermission(user, "OWNER")) ) return false;
  reverting.add(actorUuid);
  try {
    const original = await revertForm(actor);
    if ( original ) log(`${original.name} returns to their true form${reason ? ` (${reason})` : ""}`);
    return !!original;
  } finally { reverting.delete(actorUuid); }
}

/** By the active GM, or here if we are them. */
function asGM(query, handler, payload) {
  return viaActiveGM(query, handler, payload, { timeout: 20000, noGm: "Forme.SansMJ", fallback: false, label: "Wild Shape" });
}

/**
 * §16.39: intent "take this form" (known-forms window, ui/wildshape.mjs) — the suspended use restarts,
 * without dnd5e asking for a creature (a profile it does not know: `_finalizeUsage` then does not open the compendium,
 * documents/activity/transform.mjs:113-124), the chosen form noted; the transformation follows the use (below).
 * @param {Activity} activity
 * @param {[object, object, object]} usage
 * @param {string} formUuid
 */
export function takeForm(activity, [config, dialog, message], formUuid) {
  const use = { ...config, transform: { ...(config?.transform ?? {}), profile: MODULE_ID },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), wildForm: formUuid } };
  return relaunchUse(activity, use, { ...(dialog ?? {}), configure: false }, message);
}

/** Intent "resume your form" (right-click menu): the Bonus Action of the transformed sheet, legality included. */
export function leaveForm(activity, event=null) {
  return activity.use(event ? { event } : {});
}

async function onPostUse(activity, usageConfig) {
  const ours = usageConfig?.[MODULE_ID] ?? {};
  // Transformation: after the use (expenditure, Bonus Action, card), into the chosen form.
  if ( ours.wildForm && isWildShape(activity) ) {
    await asGM(TRANSFORM_QUERY, handleTransform, { actor: activity.actor.uuid, source: ours.wildForm, activity: activity.uuid });
    return;
  }
  // "Resume Form": the item placed on the transformed sheet.
  if ( activity.item?.getFlag(MODULE_ID, "revertForm") ) {
    await asGM(REVERT_QUERY, handleRevert, { actor: activity.actor.uuid, reason: "Bonus Action" });
  }
}

/** Incapacitated or 0 HP: the form ends. Active GM. */
async function endIfNeeded(actor, reason) {
  if ( !formShouldEnd(actor) ) return;
  await handleRevert({ actor: actor.uuid, reason });
}

export function registerWildShape() {
  route("dnd5e.postUseActivity", onPostUse, { label: "Wild Shape: transformation not done" });
  route("updateActor", (actor, changes) => {
    if ( !isWildShaped(actor) || !foundry.utils.hasProperty(changes, "system.attributes.hp") ) return null;
    return endIfNeeded(actor, "0 Hit Points");
  }, { executor: true, label: "Wild Shape: end at 0 Hit Points" });
  route("createActiveEffect", effect => {
    const actor = effect.parent;
    return (actor?.documentName === "Actor") && isWildShaped(actor) ? endIfNeeded(actor, "Incapacitated") : null;
  }, { executor: true, label: "Wild Shape: end if Incapacitated" });
  route("updateWorldTime", async worldTime => {
    for ( const actor of expiredForms(worldTime) ) await handleRevert({ actor: actor.uuid, reason: "duration elapsed" });
  }, { executor: true, label: "Wild Shape: end of duration" });
  CONFIG.queries[TRANSFORM_QUERY] = handleTransform;
  CONFIG.queries[REVERT_QUERY] = handleRevert;
}
