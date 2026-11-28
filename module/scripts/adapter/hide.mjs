/**
 * Hide (2024 rules, PHB glossary: "The Hide action lets you try to hide") read from Foundry. Conditions: nil visibility, or
 * three-quarters / Total Cover, AND out of the field of vision of every enemy. The engine judges the second exactly (simulated
 * vision, adapter/vision.mjs); the first follows from it — if no enemy sees you, it is darkness, a Cover or one's senses —,
 * except for enemies who see nothing anyway (Blinded): up to the GM to rule.
 * When it succeeds, Hide is an effect on the actor, which carries the DC to locate you; the engine makes it invisible to its
 * enemies (§185).
 */

import { MODULE_ID } from "../constants.mjs";
import { canLocate, isVisionAvailable } from "./vision.mjs";
import { isObjectToken } from "./bodies.mjs";
import { areEnemies } from "./factions.mjs";
import { contentOf } from "./content.mjs";
import { coverBodies, rectOf } from "./cover.mjs";
import { screenedByLarger } from "../core/hide-screen.mjs";

export const OUT_OF_ACTION = ["incapacitated", "unconscious", "paralyzed", "petrified", "stunned", "dead"];

/**
 * The active enemies who see this token, on its scene. null if the simulated vision is out of service
 * (no judgement is made).
 * @returns {TokenDocument[]|null}
 */
export function enemiesSeeing(token) {
  if ( !isVisionAvailable() || !token?.parent ) return null;
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const seeing = token.parent.tokens.filter(other => (other !== token) && other.actor && !other.hidden && !isObjectToken(other)
    && areEnemies(token, other)
    && !OUT_OF_ACTION.some(s => other.actor.statuses.has(s)) && !other.actor.statuses.has(defeated)
    && (canLocate(other, token) === true));
  // Naturally Stealthy: an enemy who sees the bearer only through a creature larger than them does not prevent them from
  // hiding.
  if ( !seeing.length || !token.actor?.items?.some(i => contentOf(i).entry?.hidesBehindLarger === true) ) return seeing;
  const hider = { rect: rectOf(token), size: token.actor.system?.traits?.size };
  return seeing.filter(other => !screenedByLarger(rectOf(other), hider, coverBodies(other, token)
    .map(t => ({ rect: rectOf(t), size: t.actor.system?.traits?.size }))));
}

/** An actor's Hide effects. */
export function hiddenEffectsOf(actor) {
  return (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "hidden"));
}

/** Data of the successful Hide effect: the Invisible condition, and the DC to locate you. */
export function hiddenEffectData(dc, name) {
  return {
    // §185: not the core's Invisible condition (it also hid the token from the group); the engine makes it invisible to its
    // enemies alone.
    name, img: "icons/svg/cowled.svg", transfer: false, disabled: false, statuses: [], changes: [],
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { hidden: { dc } } }
  };
}
