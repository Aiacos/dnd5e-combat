/**
 * §498 (brique B18) — changement de forme à volonté (`changesForm`, §76) limité dans le temps, ressources partagées. Règles pures :
 *  - `revertAfter: { rounds | seconds, auto? }` : la durée de la forme, en secondes du temps du monde (un round = `roundTime`, 6 s ;
 *    le cœur avance le temps du monde à chaque round d'un combat, `Combat#nextRound`). `auto: false` : pas de retour automatique,
 *    seulement l'entrée « Reprendre sa forme » du menu et un rappel au MJ quand la durée est écoulée.
 *  - `shareSpellSlots: true` : les emplacements dépensés sous une forme le restent sous l'autre (dépensés = max − restants, par niveau
 *    et pour la magie de pacte ; la nouvelle forme garde au plus ses propres maximums).
 */

import { isObject } from "./content/shared.mjs";

/** Les erreurs de `revertAfter` (suffixes à coller derrière `changesForm.revertAfter`). Vide = valide. */
export function revertAfterErrors(r) {
  if ( !isObject(r) ) return [": { rounds } or { seconds }"];
  const errors = [];
  const has = ["rounds", "seconds"].filter(k => k in r);
  if ( has.length !== 1 ) errors.push(": exactly one of rounds, seconds");
  if ( ("rounds" in r) && !(Number.isInteger(r.rounds) && (r.rounds >= 1)) ) errors.push(".rounds: integer ≥ 1");
  if ( ("seconds" in r) && !(Number.isFinite(r.seconds) && (r.seconds > 0)) ) errors.push(".seconds: number > 0");
  if ( ("auto" in r) && (typeof r.auto !== "boolean") ) errors.push(".auto: boolean");
  for ( const key of Object.keys(r) ) if ( !["rounds", "seconds", "auto"].includes(key) ) errors.push(`.${key}: unknown key`);
  return errors;
}

/** La durée de `revertAfter` en secondes du temps du monde (`roundTime` : la durée d'un round), ou null sans durée. */
export function revertSeconds(r, roundTime=6) {
  if ( !isObject(r) ) return null;
  if ( Number.isFinite(r.seconds) && (r.seconds > 0) ) return r.seconds;
  if ( Number.isInteger(r.rounds) && (r.rounds >= 1) ) return r.rounds * (Number(roundTime) > 0 ? Number(roundTime) : 6);
  return null;
}

/** La forme a-t-elle dépassé sa durée ? `expiresAt` : temps du monde noté au changement (null : sans durée). */
export const formExpired = (expiresAt, now) => Number.isFinite(expiresAt) && Number.isFinite(now) && (now >= expiresAt);

/** Les clés d'emplacements d'un `system.spells` de dnd5e : `spell1`…`spell9` et `pact`. */
const SLOT_KEY = /^(spell[1-9]|pact)$/;

/**
 * Les emplacements de la nouvelle forme quand les dépensés se partagent : pour chaque niveau où elle en a (`max` > 0), ses restants =
 * max − dépensés par l'ancienne forme à ce niveau (au moins 0). Un niveau que l'ancienne forme n'a pas ne dépense rien.
 * @param {object} from  `system.spells` de la forme quittée ({ spell1: { value, max }, … })
 * @param {object} to    `system.spells` de la forme prise
 * @returns {Record<string, number>}  `{ "system.spells.spell1.value": n, … }`, seulement les niveaux qui changent
 */
export function sharedSlotUpdates(from, to) {
  const out = {};
  for ( const [key, slot] of Object.entries(to ?? {}) ) {
    if ( !SLOT_KEY.test(key) ) continue;
    const max = Number(slot?.max) || 0;
    if ( max <= 0 ) continue;
    const old = from?.[key];
    const spent = Math.max(0, (Number(old?.max) || 0) - (Number(old?.value) || 0));
    const value = Math.max(0, max - spent);
    if ( value !== Number(slot?.value) ) out[`system.spells.${key}.value`] = value;
  }
  return out;
}
