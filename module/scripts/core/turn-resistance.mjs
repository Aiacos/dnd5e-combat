/**
 * `resist` step of a reaction to a hit (Superior Hunter's Defense: "when you take damage, your Reaction gives you
 * Resistance to that damage and to any other damage of the same type until the end of the current turn"). Pure function: the
 * changes of the effect to apply, in the shape of dnd5e's data (`system.traits.dr.value`, "add", like Rage).
 * @param {string[]} types               the damage types of the hit
 * @param {{resisted?: Iterable<string>, immune?: Iterable<string>}} [bearer]  what the bearer already has
 * @returns {Array<{key: string, type: "add", value: string, phase: "initial"}>}  nothing if everything is already covered
 */
export function turnResistanceChanges(types, { resisted=[], immune=[] }={}) {
  const covered = new Set([...resisted, ...immune]);
  return [...new Set(types ?? [])].filter(t => (typeof t === "string") && t && !covered.has(t))
    .map(value => ({ key: "system.traits.dr.value", type: "add", value, phase: "initial" }));
}

/**
 * Does the entry declare a `resist` reaction played by this activity? The engine then applies the wanted Resistance itself, and
 * the activity's effects (one per damage type in the data) are not applied. Pure function.
 * @param {object|null|undefined} entry
 * @param {string} activityId
 */
export function placesOwnResistance(entry, activityId) {
  return (entry?.triggers ?? []).some(d => (d.do ?? []).some(s => s?.type === "resist")
    && (d.do ?? []).some(s => (s?.type === "use") && (!s.activity || (s.activity === activityId))));
}
