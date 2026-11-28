/**
 * Duplicates (SPEC §16.25, key `duplicates` of core/content.mjs): Mirror Image. Each effect of the item that the creature carries
 * is a duplicate (dnd5e 6 places three, "Duplicate A/B/C", which also count `flags.dnd-players-handbook.mirrorImages`).
 * Verified text (spells24, mirror-image.yml): on each attack that hits the caster, a d6 per duplicate; a 3 or higher on
 * any of them redirects the hit onto a duplicate, which disappears. An attacker that is Blinded, or has Blindsight or
 * Truesight, is not fooled.
 */

import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";

/** The duplicate effects the actor carries, one per remaining duplicate. */
export function duplicateEffectsOf(actor) {
  return (actor?.appliedEffects ?? []).filter(effect => {
    if ( effect.disabled || effect.isSuppressed ) return false;
    const item = originItemOf(effect);
    return !!item && (contentOf(item).entry?.duplicates === true);
  });
}

/** Is the attacker fooled by the duplicates? (dnd5e senses-field.mjs:15: `senses.ranges`) */
export function fooledByDuplicates(attacker) {
  if ( !attacker ) return true;
  if ( attacker.statuses?.has("blinded") ) return false;
  const ranges = attacker.system?.attributes?.senses?.ranges ?? {};
  return !((Number(ranges.blindsight) > 0) || (Number(ranges.truesight) > 0));
}

/** How many duplicates can take this hit in the target's place (0: none, or attacker unaffected). */
export function duplicatesAgainst(targetActor, attackerActor) {
  const count = duplicateEffectsOf(targetActor).length;
  return (count && fooledByDuplicates(attackerActor)) ? count : 0;
}
