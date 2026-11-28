/**
 * "Cannot benefit from the Invisible condition" (SPEC §16.36, key `revealsInvisible`: Faerie Fire, Stardust),
 * down to the display. The V14 core hides an Invisible token from those who do not detect it, as soon as the
 * condition is on the actor; the engine does not patch the detection modes. As long as the creature is revealed, its
 * effects that give Invisible (Invisibility spell, hiding, ticked condition) are therefore **suspended** — disabled, marked
 * `flags["dnd5e-combat"].veiled` — and re-enabled when the last reveal falls. The Invisibility spell and its
 * concentration go on: it is its benefit that is suspended, as the rule says.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

const INVISIBLE = "invisible";
const statusesIn = effect => effect?.statuses instanceof Set ? effect.statuses : new Set(effect?.statuses ?? []);

/** An effect that gives the Invisible condition? */
export function grantsInvisible(effect) {
  return statusesIn(effect).has(INVISIBLE);
}

/** An effect that reveals its bearer (from a `revealsInvisible` item)? */
export function isRevealEffect(effect) {
  const item = originItemOf(effect);
  return !!item && (contentOf(item).entry?.revealsInvisible === true);
}

/** Does the actor carry an active reveal (apart from `except`)? */
export function isRevealed(actor, except=null) {
  for ( const effect of actor?.appliedEffects ?? actor?.effects ?? [] ) {
    if ( (effect === except) || effect.disabled || effect.isSuppressed ) continue;
    if ( isRevealEffect(effect) ) return true;
  }
  return false;
}

/**
 * On creating an effect (`preCreateActiveEffect`, on the client that writes it): an effect that makes a revealed creature Invisible
 * is born suspended. Returns true if it was.
 */
export function veilOnCreate(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || effect.disabled || !grantsInvisible(effect) || !isRevealed(actor) ) return false;
  effect.updateSource({ disabled: true, [`flags.${MODULE_ID}.veiled`]: true });
  return true;
}

/** A reveal arrives: the Invisibility effects already there are suspended. Active GM. Returns their number. */
export async function veilExisting(actor) {
  const updates = (actor?.effects ?? []).filter(e => !e.disabled && grantsInvisible(e) && !isRevealEffect(e))
    .map(e => ({ _id: e.id, disabled: true, [`flags.${MODULE_ID}.veiled`]: true }));
  if ( updates.length ) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  return updates.length;
}

/** The last reveal falls (`gone`: the departing effect): the suspended effects resume. Active GM. Returns their number. */
export async function unveil(actor, gone=null) {
  if ( !actor || isRevealed(actor, gone) ) return 0;
  const updates = (actor.effects ?? []).filter(e => e.getFlag(MODULE_ID, "veiled"))
    .map(e => ({ _id: e.id, disabled: false, [`flags.${MODULE_ID}.veiled`]: false }));
  if ( updates.length ) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  return updates.length;
}
