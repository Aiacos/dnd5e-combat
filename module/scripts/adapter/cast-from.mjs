/**
 * `castFromBearer` (core/cast-from-bearer.mjs): the tokens an actor may also measure their spell range from — those carrying an
 * effect of one of their items that declares the key, within the stated distance (Gaze of Two Minds).
 */

import { linkHolds } from "../core/cast-from-bearer.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { distanceBetween } from "./turn.mjs";
import { lengthIn } from "./units.mjs";

/** The tokens on `origin`'s scene linked to `actor` by a `castFromBearer` effect, close enough to it. */
export function linkedBearers(actor, origin, factors) {
  const out = [];
  if ( !actor || !origin?.parent ) return out;
  for ( const token of origin.parent.tokens ) {
    if ( token === origin ) continue;
    for ( const effect of token.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.isSuppressed ) continue;
      const item = originItemOf(effect);
      const rule = (item?.actor === actor) ? contentOf(item).entry?.castFromBearer : null;
      if ( !rule ) continue;
      const limit = lengthIn(rule.distance, rule.units, origin.parent.grid.units, factors);
      if ( linkHolds(distanceBetween(origin, token).value, limit) ) { out.push(token); break; }
    }
  }
  return out;
}
