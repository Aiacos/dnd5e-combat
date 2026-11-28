/**
 * Vibrating Palm (Monk, Open Hand 17 — SRD 5.2): "when you hit a creature with an Unarmed Strike, you
 * can spend 4 Focus Points to start vibrations […] You can have only one creature under the effect of
 * this feature at a time. […] When you end it, the target must make a Constitution saving throw". Pure
 * functions, on the `heldEffect` rule: an effect of the item that only one creature bears, and that one of its activities ends.
 */

/**
 * The effects to remove when this one has just been placed: the other effects of the same item, on other creatures.
 * @param {{single?: true}} rule
 * @param {{id: string, bearer: string}} placed                          the placed effect, its bearer
 * @param {Array<{id: string, bearer: string}>} others                   all the effects of this item effect in the scene
 * @returns {Array<{id: string, bearer: string}>}
 */
export function supersededEffects(rule, placed, others) {
  if ( rule?.single !== true ) return [];
  return (others ?? []).filter(e => (e.id !== placed.id) && (e.bearer !== placed.bearer));
}

/** Does this activity end the held effect? */
export function endsHeldEffect(rule, activityId) {
  return !!rule && !!activityId && (rule.endedBy === activityId);
}

/** Can a hit boon be paid for? It takes `cost` uses (one by default). */
export function riderAffordable(left, cost=1) {
  return left >= Math.max(1, Number(cost) || 1);
}
