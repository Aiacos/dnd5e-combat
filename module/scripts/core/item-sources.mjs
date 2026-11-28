/**
 * §276: where an item comes from, for the diagnostic's repairs (`runtime/diagnostic/checks.mjs`). Pure: no dependency on Foundry.
 *  - "reference": the reference compendia (Player's Handbook, Monster Manual, dnd5e) — those where a replacement is looked for;
 *  - "premium"  : another official module (`dnd-…`: Ravenloft, Dungeon Master's Guide…) — it is already the official item, it is
 *    never replaced by a namesake from another book (Ravenloft's "Survivor" is not the Champion's "Survivor", same identifier);
 *  - "other"    : a third-party module or an import (CPR, D&D Beyond, world) — to be taken over;
 *  - "none"     : no source.
 */

export const REFERENCE_SOURCE = /^Compendium\.(dnd-players-handbook|dnd-monster-manual|dnd5e)\./;
export const PREMIUM_SOURCE = /^Compendium\.dnd-[a-z0-9-]+\./;

/** @param {string|null|undefined} src  `_stats.compendiumSource` */
export function sourceKind(src) {
  if ( !src ) return "none";
  if ( REFERENCE_SOURCE.test(src) ) return "reference";
  if ( PREMIUM_SOURCE.test(src) ) return "premium";
  return "other";
}
