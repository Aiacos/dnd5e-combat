/**
 * §438: an activity's level gate, read on the dnd5e activity (pure: core/level-gate.mjs).
 */

import { hiddenAtLevel } from "../core/level-gate.mjs";

/**
 * §438: an activity hidden at this level by the data (`visibility.level`; dnd5e 6.1.0 `isHidden`, dnd5e.mjs:18844-18853 —
 * `relevantLevel`: the named class's level, otherwise the character's). The Player's Handbook 3.0.0 stores the upgraded
 * versions of a feature as activities of the same item, one visible up to a level, the other from the next ("Protective
 * Burst", Flurry of Blows "Heightened"): the content names them all, only the one for the level is offered. Nothing else from
 * `isHidden` is taken over (an item hidden on the sheet keeps its reactions).
 */
export function levelHidden(activity) {
  const range = activity?.visibility?.level;
  if ( !range || ((range.min == null) && (range.max == null)) ) return false;
  let level;
  try { level = Number(activity.relevantLevel); } catch { return false; }
  return hiddenAtLevel(range, level);
}
