/**
 * B09 (§488): a worn item that locks its bearer's form (`formLock: { worn: true, onAttempt?, forms? }`). Each attempt
 * to change form — a transformation activity (the refusal is in legality: runtime/turn.mjs `useIssues`), or a form effect
 * turned on by hand on the sheet — inflicts the `onAttempt` steps on the bearer (damage, roll visible to all, by the active GM),
 * with a notice and a sound for the whole table; the attempt is refused, and can be forced ("Use anyway" window, the GM
 * warned). The suspension of traits (`suspends`) is read where the trait is read (adapter/regeneration.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { needsCheck } from "../core/requests.mjs";
import { formAttemptLock, effectAttemptLock, wornFormLockOf } from "../adapter/form-lock.mjs";
import { inflict } from "../adapter/retaliation.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { isDeadActor } from "../adapter/death.mjs";
import { askAnyway } from "./turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaActiveGM } from "./shared.mjs";

export const FORM_LOCK_QUERY = `${MODULE_ID}.formLock`;

/** An actor's attempt, on the active GM: the `onAttempt` steps of the lock they carry, re-read here (the request is not trusted). */
async function handleAttempt({ actor: actorUuid }={}, { user=null }={}) {
  const actor = actorUuid ? fromUuidSync(actorUuid, { strict: false }) : null;
  // §472: from a player, only for a creature they own (safety refusal, not forceable).
  if ( actor && needsCheck(user) && !actor.testUserPermission(user, "OWNER") ) {
    console.warn(`${MODULE_ID} | form lock query from ${user.name} refused: not the owner of ${actor.name}`);
    return false;
  }
  const lock = wornFormLockOf(actor);
  if ( !lock ) return false;
  const token = tokenOf(actor);
  notice(token, { key: "FormeVerrouillee.Echec", data: { item: lock.item.name, name: token?.name ?? actor.name } }, "refused",
    { all: true, action: "formLock", outcome: "failure" });
  if ( !token ) { log(`${lock.item.name}: ${actor.name} has no token, no damage`); return true; }
  if ( isDeadActor(actor) ) return true;
  for ( const step of lock.onAttempt ) {
    await inflict({
      step, item: lock.item, targetUuid: token.uuid,
      speaker: ChatMessage.implementation.getSpeaker({ token }),
      flavor: loc("FormeVerrouillee.Degats", { item: lock.item.name, name: token.name }),
      flags: { formLock: { item: lock.item.uuid } }
    });
  }
  log(`${lock.item.name}: ${actor.name} tried to change form — refused${lock.onAttempt.length ? ", damage taken" : ""}`);
  return true;
}

/** Plays the attempt (by the active GM). */
export function punishAttempt(actor) {
  return viaActiveGM(FORM_LOCK_QUERY, handleAttempt, { actor: actor.uuid }, { fallback: false, label: "form lock: attempt not played" });
}

/**
 * Before legality (registered just before `registerTurn`): a transformation activity that the carried item forbids — the steps
 * are played once per attempt; the confirmed retry ("Use anyway") does not replay them. The refusal itself: `useIssues`.
 */
function onPreUseActivity(activity, usageConfig) {
  if ( usageConfig?.[MODULE_ID]?.confirmed || !formAttemptLock(activity) ) return;
  punishAttempt(activity.actor).catch(err => console.error(`${MODULE_ID} | form lock`, err));
}

/**
 * A form effect turned on by hand (Hybrid Form, Wolf Form) on a bearer of the lock: refused, the steps played, then the
 * "Use anyway" window — forced, the effect turns on (option `formLockForced`, the GM notified).
 */
function onPreUpdateEffect(effect, changes, options) {
  if ( (foundry.utils.getProperty(changes, "disabled") !== false) || !effect.disabled ) return true;
  if ( options?.[MODULE_ID]?.formLockForced ) return true;
  const attempt = effectAttemptLock(effect);
  if ( !attempt ) return true;
  const { lock, actor } = attempt;
  punishAttempt(actor).catch(err => console.error(`${MODULE_ID} | form lock`, err));
  askAnyway(`${effect.name} — ${actor.name}`, [loc("Souci.formLockedWorn", { item: lock.item.name })], { actor, item: effect.name })
    .then(go => go && effect.update({ disabled: false }, { [MODULE_ID]: { formLockForced: true } }))
    .catch(err => console.error(`${MODULE_ID} | form lock: forced effect`, err));
  return false;
}

export function registerFormLock() {
  CONFIG.queries[FORM_LOCK_QUERY] = handleAttempt;
  route("dnd5e.preUseActivity", onPreUseActivity, { label: "worn form lock: attempt not punished" });
  route("preUpdateActiveEffect", onPreUpdateEffect, { cancellable: true, label: "worn form lock: form effect not refused" });
}
