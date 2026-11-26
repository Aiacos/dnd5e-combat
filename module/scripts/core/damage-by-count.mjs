/**
 * Damage that depends on the number chosen at another activity of the item (content key `damageByCount`): Ring of Shooting
 * Stars, Lightning Spheres — "the creature takes Lightning damage based on the number of spheres you created" (SRD 5.2;
 * 1: 4d12, 2: 5d4, 3: 2d6, 4: 2d4). The number is noted on the item when created, the formula read at the damage roll.
 * Pure functions.
 */

/** The number a use states: 1, plus the scaling chosen (an activity whose consumption scales "per sphere"). */
export function countOfUse(scaling) {
  const increase = Number(scaling);
  return 1 + (Number.isInteger(increase) && (increase > 0) ? increase : 0);
}

/** The formula for that number, or null (nothing noted, or out of the table): the data then stays as it is. */
export function formulaForCount(rule, count) {
  const n = Number(count);
  return (rule && Number.isInteger(n) && (n >= 1)) ? (rule.formulas?.[n - 1] ?? null) : null;
}

/** The key's errors. Empty = valid. */
export function validateDamageByCount(rules, at, isId) {
  const rule = r => r && (typeof r === "object") && isId(r.from) && Array.isArray(r.formulas) && r.formulas.length
    && r.formulas.every(f => (typeof f === "string") && f.trim()) && Object.keys(r).every(k => ["from", "formulas"].includes(k));
  const ok = rules && (typeof rules === "object") && !Array.isArray(rules) && Object.keys(rules).length
    && Object.entries(rules).every(([id, r]) => isId(id) && rule(r));
  return ok ? [] : [`${at}damageByCount: { <activity id>: { from: activity id, formulas: [formula, …] } }`];
}
