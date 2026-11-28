/**
 * §105: sharing another creature's cell, seen from Foundry. A sheet ability (content `sharesSpace`, by
 * identifier: Air Form, Swarm…) counts by its presence; a spell (Gaseous Form) only by the effect it placed — knowing
 * it is not enough.
 */

import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { mayShareSpace, widerShare } from "../core/space-sharing.mjs";
import { samePlane } from "./plane.mjs";

/** @returns {"enter"|"mutual"|null} */
export function shareKindOf(actor) {
  if ( !actor ) return null;
  let kind = null;
  for ( const item of actor.items ?? [] ) {
    if ( item.type === "spell" ) continue;
    kind = widerShare(kind, contentOf(item).entry?.sharesSpace ?? null);
  }
  for ( const effect of actor.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item ) kind = widerShare(kind, contentOf(item).entry?.sharesSpace ?? null);
  }
  return kind;
}

/**
 * Can the moving token pass through the other's cell and stop in it? Token documents.
 * @param {TokenDocument} mover
 * @param {TokenDocument} occupant
 * @param {object} [options]
 * @param {"enter"|"mutual"|null} [options.moverKind]  `shareKindOf(mover.actor)` already read by the caller, which compares the
 *   same token with all those of a scene (adapter/path-world.mjs): its items are not reread for each occupant.
 */
export function sharesSpaceWith(mover, occupant, { moverKind }={}) {
  if ( !mover?.actor || !occupant?.actor ) return false;
  if ( !samePlane(mover, occupant) ) return true;   // §225: from one plane to the other, they do not get in each other's way
  return mayShareSpace((moverKind !== undefined) ? moverKind : shareKindOf(mover.actor), shareKindOf(occupant.actor));
}
