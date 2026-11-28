/**
 * M8 (SPEC §18.15): the creatures that do not provoke an Opportunity Attack — `noOpportunity` content, by identifier:
 *  - `always`: Agile (Stag, Rat) — "doesn't provoke an Opportunity Attack when it moves out of an enemy's reach";
 *  - `flying`: Flyby (Owl, Gargoyle, Hippogriff…) — "… when it flies out of an enemy's reach";
 *  - `afterUse`: an action "moves up to its Speed without provoking Opportunity Attacks" (Trampling Charge, "Prowl"…) —
 *    when used, the rest of the turn plays out as after Disengage (runtime/turn.mjs). The original English text must
 *    say so: two MM "Engulf" share the same identifier, only one moves without provoking;
 *  - `whileEffect` (§74): as long as the creature carries an effect of the item (Zephyr Strike).
 */

import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";
import { isAirborne } from "./altitude.mjs";
import { originItemOf } from "./facts.mjs";

const kindsOf = actor => new Set((actor?.items ?? []).map(i => contentOf(i).entry?.noOpportunity).filter(Boolean));

/**
 * Does this movement escape Opportunity Attacks through a passive ability? Flyby: a step in flight (core V14 `fly`
 * movement action), or a start in the air.
 * @param {Actor5e} actor
 * @param {TokenDocument} token
 * @param {object[]} waypoints
 */
export function avoidsOpportunity(actor, token, waypoints) {
  const kinds = kindsOf(actor);
  if ( kinds.has("always") ) return true;
  // §74: `whileEffect` — as long as the creature carries an effect of the item (Zephyr Strike: "until the spell ends, your
  // movement does not provoke Opportunity Attacks").
  if ( kinds.has("whileEffect") && (actor?.appliedEffects ?? actor?.effects ?? []).some(e => !e.disabled && !e.isSuppressed
    && (contentOf(originItemOf(e)).entry?.noOpportunity === "whileEffect")) ) return true;
  if ( !kinds.has("flying") ) return false;
  return waypoints.some(w => w.action === "fly") || (token ? isAirborne(token) : false);
}

/** Does the item used free the rest of the turn from Opportunity Attacks? */
export function freesMovement(item) {
  if ( contentOf(item).entry?.noOpportunity !== "afterUse" ) return false;
  const text = englishDescription(item).replace(/&amp;/g, "&").replace(/&Reference\[([^\]]*)\](?:\{[^}]*\})?/g, "$1");
  return /without provoking\W+(?:an\W+)?opportunity\W*attacks?/i.test(text);
}
