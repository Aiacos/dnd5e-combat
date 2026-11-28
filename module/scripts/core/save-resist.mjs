/**
 * An item that turns a failed saving throw into a success (content key `saveResist`): Staff of Charming — "if you fail a saving
 * throw against an enchantment spell that targets only you, you can turn your failure into a success; you can't use this
 * property again until the next dawn". The uses are those of the item's activity. Pure functions.
 */

/**
 * Does the rule apply against what imposes the saving throw?
 * @param {{activity: string, schools?: string[], singleTarget?: boolean}|null|undefined} rule
 * @param {{isSpell: boolean, school: string|null, targets: number}} against
 */
export function saveResistApplies(rule, { isSpell, school, targets }) {
  if ( !rule?.activity || !isSpell ) return false;
  if ( rule.schools && !rule.schools.includes(school) ) return false;
  return !rule.singleTarget || (targets === 1);
}

/**
 * `saveReflect`: the same shape, for a SUCCEEDED saving throw — "if you succeed on a saving throw against an enchantment
 * spell that targets only you, you can use your Reaction to expend 1 charge and turn the spell back on its caster, as if you had
 * cast it". Does it apply, with a charge and a Reaction?
 */
export function saveReflectApplies(rule, against, { charges, reaction }) {
  return saveResistApplies(rule, against) && (charges >= 1) && (reaction !== false);
}

/** The key's errors. Empty = valid. */
export function validateSaveResist(rule, at, isId, key="saveResist") {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && isId(rule.activity)
    && (!("schools" in rule) || (Array.isArray(rule.schools) && rule.schools.length && rule.schools.every(s => typeof s === "string")))
    && (!("singleTarget" in rule) || (rule.singleTarget === true))
    && Object.keys(rule).every(k => ["activity", "schools", "singleTarget"].includes(k));
  return ok ? [] : [`${at}${key}: { activity: activity id, schools?: [spell schools], singleTarget?: true }`];
}
