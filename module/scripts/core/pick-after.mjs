/**
 * §438: a manifestation followed by a save "on a creature of your choice in the Emanation" (Handbook 3.0.0's "Wrath of the
 * Seas": the utility activity "Manifest Ocean Spray" places the Emanation, the save is the sibling activity). The 2024 rule chains
 * the two under the same Bonus Action (user decision, 2026-11-14): `pickTargets.after` names, for the activity that manifests,
 * the activity that follows and around whom one chooses (`self`: the caster; `targets`: the creatures targeted by the
 * manifestation — "Wrath of the Seas" "Another", level 14). Pure rules.
 */

/** What follows the use of this activity, or null. An activity that resolves itself (2.2.0 form: the save) chains nothing. */
export function chainedPickOf(rule, activityId, activityType) {
  const next = rule?.after?.[activityId] ?? null;
  return (next && (activityType === "utility")) ? next : null;
}

/** Does the choice list apply to this activity? Not to the utility manifestation, which places the Emanation, not a target. */
export function picksFor(rule, activityId, activityType) {
  if ( !rule?.activities?.includes(activityId) ) return false;
  return !chainedPickOf(rule, activityId, activityType);
}

/**
 * The retained distance of a creature: the shortest to one of the centers, each with its radius. Null outside any Emanation.
 * @param {Array<{distance: number, radius: number}>} centers
 * @returns {number|null}
 */
export function withinCenters(centers) {
  const inside = centers.filter(c => Number.isFinite(c.distance) && (c.distance <= c.radius + 1e-6)).map(c => c.distance);
  return inside.length ? Math.min(...inside) : null;
}
