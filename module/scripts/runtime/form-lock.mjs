/**
 * B09 (§488) : un objet porté qui verrouille la forme de son porteur (`formLock: { worn: true, onAttempt?, forms? }`). Chaque tentative
 * de changer de forme — une activité de transformation (le refus est dans la légalité : runtime/turn.mjs `useIssues`), ou un effet de
 * forme allumé à la main sur la fiche — inflige au porteur les étapes `onAttempt` (des dégâts, jet visible de tous, par le MJ actif),
 * avec un avis et un son pour toute la table ; la tentative est refusée, et peut être forcée (fenêtre « Utiliser quand même », le MJ
 * prévenu). La suspension des traits (`suspends`) se lit là où le trait se lit (adapter/regeneration.mjs).
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

/** La tentative d'un acteur, chez le MJ actif : les étapes `onAttempt` du verrou qu'il porte, relu ici (rien n'est cru de la requête). */
async function handleAttempt({ actor: actorUuid }={}, { user=null }={}) {
  const actor = actorUuid ? fromUuidSync(actorUuid, { strict: false }) : null;
  // §472 : d'un joueur, seulement pour une créature qu'il possède (refus de sécurité, non forçable).
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

/** Joue la tentative (par le MJ actif). */
export function punishAttempt(actor) {
  return viaActiveGM(FORM_LOCK_QUERY, handleAttempt, { actor: actor.uuid }, { fallback: false, label: "form lock: attempt not played" });
}

/**
 * Avant la légalité (inscrit juste avant `registerTurn`) : une activité de transformation que l'objet porté interdit — les étapes se
 * jouent une fois par tentative ; la relance confirmée (« Utiliser quand même ») ne les rejoue pas. Le refus lui-même : `useIssues`.
 */
function onPreUseActivity(activity, usageConfig) {
  if ( usageConfig?.[MODULE_ID]?.confirmed || !formAttemptLock(activity) ) return;
  punishAttempt(activity.actor).catch(err => console.error(`${MODULE_ID} | form lock`, err));
}

/**
 * Un effet de forme allumé à la main (Forme hybride, Forme de loup) chez un porteur du verrou : refusé, les étapes jouées, puis la fenêtre
 * « Utiliser quand même » — forcé, l'effet s'allume (option `formLockForced`, le MJ prévenu).
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
