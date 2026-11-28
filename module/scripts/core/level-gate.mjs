/**
 * §438: an activity's level gate (dnd5e 6.1, `visibility.level { min, max }`) — the Player's Handbook 3.0.0 arranges the
 * upgraded versions of a feature as activities of the same item, one visible up to a level, the other from the next. Pure.
 */

/**
 * Is the activity hidden at this level? With no gate (or null bounds), or no readable level: no.
 * @param {{min?: number|null, max?: number|null}|null|undefined} range
 * @param {number} level  The level that counts (dnd5e's `relevantLevel`: the named class, else the character, or the spell).
 */
export function hiddenAtLevel(range, level) {
  if ( !range || ((range.min == null) && (range.max == null)) ) return false;
  if ( !Number.isFinite(level) ) return false;
  return ((range.min ?? -Infinity) > level) || ((range.max ?? Infinity) < level);
}
