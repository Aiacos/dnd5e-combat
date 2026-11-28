/**
 * §105: share another creature's cell. dnd5e decides who blocks a move in
 * `TokenLayer5e#isOccupiedGridSpaceBlocking` (canvas/layers/tokens.mjs:10-49: only allies, creatures two sizes
 * apart and Tiny ones can be passed through) and then publishes `dnd5e.determineOccupiedGridSpaceBlocking(gridSpace, token,
 * options, found)`, whose `found` set can be modified (tokens.mjs:36-47): we remove from it the occupant whose cell we can
 * share. dnd5e's constrained path (canvas/token.mjs:113-118) and the engine's A* (adapter/movement.mjs, `blocked`) read
 * that same function; the end of a move ("never on an occupied cell") reads `sharesSpaceWith` itself.
 */

import { sharesSpaceWith } from "../adapter/space-sharing.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { route } from "./router.mjs";

function onBlocking(gridSpace, token, options, found) {
  if ( !found?.size || !token?.document ) return;
  for ( const other of Array.from(found) ) {
    if ( sharesSpaceWith(token.document, other.document) ) found.delete(other);
  }
}

export function registerSpaceSharing() {
  route("dnd5e.determineOccupiedGridSpaceBlocking", onBlocking, { label: "space sharing: passage refused" });
}

/**
 * §255: an object (placed trap, spiritual weapon: `flags.dnd5e-combat.object`) is not a creature — it does not block passage
 * and does not make its cell difficult, whatever the automation level. dnd5e judged it a creature of another side: a
 * spotted trap, visible again, closed the corridor (core drag and engine path).
 */
function dropObjects(gridSpace, token, options, found) {
  if ( !found?.size ) return;
  for ( const other of Array.from(found) ) if ( isObjectToken(other.document) ) found.delete(other);
}

export function registerObjectPassage() {
  route("dnd5e.determineOccupiedGridSpaceBlocking", dropObjects, { label: "objects: never block" });
  route("dnd5e.determineOccupiedGridSpaceDifficult", dropObjects, { label: "objects: no difficult terrain" });
}
