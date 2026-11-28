/**
 * Search (SPEC §16.49) read in Foundry: the hidden creatures the observer could find, and what decides
 * each one (core/search.mjs). A creature is hidden as long as it carries the engine's Stealth effect (adapter/hide.mjs),
 * which keeps its Stealth total: the DC to find it.
 */

import { MODULE_ID } from "../constants.mjs";
import { hardToPerceive } from "./defenses.mjs";
import { LIGHT } from "../core/illumination.mjs";
import { hiddenEffectsOf, OUT_OF_ACTION } from "./hide.mjs";
import { canLocate, blockedBetween, hasLineOfSight } from "./vision.mjs";
import { perceivedOnToken, sensesToward, tokenPoint } from "./illumination.mjs";
import { committedPosition } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";
import { areEnemies } from "./factions.mjs";
import { outsideCone } from "./cone.mjs";

/** The DC to find this hidden actor (the highest of its Stealth effects), or null if it is not hidden. */
export function hiddenDcOf(actor) {
  const dcs = hiddenEffectsOf(actor).map(e => Number(e.getFlag(MODULE_ID, "hidden")?.dc)).filter(Number.isFinite);
  return dcs.length ? Math.max(...dcs) : null;
}

/**
 * The hidden creatures, hostile to the observer, on its scene, with what decides each one.
 * @param {TokenDocument} searcher
 * @returns {Array<{id: string, token: TokenDocument, dc: number, sensed: boolean, seeable: boolean, disadvantage: boolean}>}
 */
export function searchCandidates(searcher) {
  const scene = searcher?.parent;
  if ( !scene || !canvas?.ready ) return [];
  const out = [];
  for ( const token of scene.tokens ) {
    if ( (token === searcher) || token.hidden || !token.actor || isObjectToken(token) ) continue;
    if ( !areEnemies(searcher, token) ) continue;
    const dc = hiddenDcOf(token.actor);
    if ( dc === null ) continue;
    out.push({ id: token.uuid, token, dc, ...sightingOf(searcher, token) });
  }
  return out;
}

/**
 * What the observer perceives of a hidden creature: `sensed` (its senses perceive it despite Invisible, `canSee`),
 * `seeable` (not Blinded, line of sight, no fog or Darkness between the two that it does not pierce, perceived light other than
 * Darkness at the hiding point), `disadvantage` (area lightly obscured for it). Shared by Search and
 * Passive Perception (§16.49, §16.51).
 * @param {TokenDocument} observer
 * @param {TokenDocument} target
 * @returns {{sensed: boolean, seeable: boolean, disadvantage: boolean}}
 */
export function sightingOf(observer, target) {
  const sensed = canLocate(observer, target) === true;
  if ( sensed || observer.actor?.statuses?.has("blinded") ) return { sensed, seeable: false, disadvantage: false };
  const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? tokenPoint(observer);
  const blocked = blockedBetween(observer, target);
  const senses = sensesToward(observer, tokenPoint(target));
  const throughDarkness = senses.devilsSight || senses.truesight;
  // Issue #42: through Darkness, the line of sight without its edges (adapter/vision.mjs, `throughDarkness`) — otherwise
  // Devil's Sight and Truesight never spotted a creature hidden in Darkness.
  if ( !hasLineOfSight(eye, target, observer.parent.levels?.get?.(observer.level), { throughDarkness: blocked.darkness ? throughDarkness : blocked.ownDarkness,
    externalRadius: observer.object?.externalRadius ?? 0 }) ) {
    return { sensed, seeable: false, disadvantage: false };
  }
  if ( outsideCone(observer, target) ) return { sensed, seeable: false, disadvantage: false };   // §182 : dans son dos
  const light = perceivedOnToken(observer, target);
  const seeable = !blocked.fog && (!blocked.darkness || throughDarkness) && !!light && (light.perceived !== LIGHT.DARK);
  return { sensed, seeable, disadvantage: seeable && light.perceptionDisadvantage };
}

/**
 * Passive Perception (§16.51): the enemies of the hidden creature, on its scene, able to act (not Incapacitated, not
 * Unconscious…, not defeated), not hidden by the GM, with their Passive Perception (`skills.prc.passive` of dnd5e) and what they
 * perceive of it.
 * @param {TokenDocument} hidden
 * @returns {Array<{token: TokenDocument, passive: number, sensed: boolean, seeable: boolean, disadvantage: boolean}>}
 */
export function passiveObservers(hidden) {
  const scene = hidden?.parent;
  if ( !scene || !canvas?.ready || (scene !== canvas.scene) ) return [];
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const out = [];
  for ( const token of scene.tokens ) {
    const actor = token.actor;
    if ( (token === hidden) || token.hidden || !actor || isObjectToken(token) ) continue;
    if ( !areEnemies(hidden, token) ) continue;
    if ( OUT_OF_ACTION.some(s => actor.statuses.has(s)) || actor.statuses.has(defeated) ) continue;
    // O9g (§361) : contre un porteur de Cape elfique, la Perception passive perd 5.
    const passive = Number(actor.system?.skills?.prc?.passive) - (hardToPerceive(hidden.actor) ? 5 : 0);
    out.push({ token, passive, ...sightingOf(token, hidden) });
  }
  return out;
}

/**
 * The Perception check as core/search.mjs reads it. The d20s are only returned for a check with Disadvantage (two d20s, the
 * lower kept): that is the only case where the total without Disadvantage is drawn from them. Rerolled d20s (Lucky…) are discarded.
 * @param {D20Roll} roll
 * @returns {{total: number, d20: number[], kept: number|null}}
 */
export function perceptionRollParts(roll) {
  const total = roll?.total;
  if ( !roll?.hasDisadvantage ) return { total, d20: [], kept: null };
  const results = (roll.dice?.[0]?.results ?? []).filter(r => !r.rerolled);
  const d20 = results.map(r => r.result);
  const kept = results.find(r => r.active)?.result ?? null;
  return { total, d20, kept };
}
