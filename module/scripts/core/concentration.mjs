/**
 * §494 (brick B14): several Concentrations at once. dnd5e 6 carries the limit (`system.attributes.concentration.limit`,
 * 1 by default): at the limit, a new Concentration spell replaces that of the same item, otherwise the first; a failed
 * Concentration check ends them all (`endConcentration()` without argument, "Break Concentration" button). What is missing is
 * the limit carried by a creature trait ("it can concentrate on three spells at once"): the content key
 * `concentration: { limit, loseAll? }`, which the engine holds in the effect of feats without an effect
 * (runtime/speed-grants.mjs). Pure functions.
 */

export const CONCENTRATION_LIMIT_KEY = "system.attributes.concentration.limit";

/** Validation of the `concentration` key; returns the list of errors. */
export function validateConcentrationRule(rule) {
  const ok = (rule !== null) && (typeof rule === "object") && !Array.isArray(rule)
    && Number.isInteger(rule.limit) && (rule.limit >= 1) && (rule.limit <= 20)
    && (!("loseAll" in rule) || (rule.loseAll === true))
    && Object.keys(rule).every(k => ["limit", "loseAll"].includes(k));
  return ok ? [] : ["concentration: { limit: integer 1–20, loseAll?: true }"];
}

/**
 * The creature's Concentration rule, from the entries of its items: the highest limit, and "loses all" if one says so.
 * @param {Array<object|null>} entries  The content entries of its items.
 * @returns {{limit: number, loseAll: boolean}|null}  null: no item declares a rule.
 */
export function concentrationRuleOf(entries) {
  const rules = (entries ?? []).map(e => e?.concentration).filter(r => Number.isInteger(r?.limit));
  if ( !rules.length ) return null;
  return { limit: Math.max(...rules.map(r => r.limit)), loseAll: rules.some(r => r.loseAll === true) };
}

/** The effect changes that carry the limit ("upgrade": an effect of the sheet that raises it higher keeps the upper hand). */
export function concentrationLimitChanges(rule) {
  const limit = Number(rule?.limit);
  return (Number.isInteger(limit) && (limit > 1)) ? [{ key: CONCENTRATION_LIMIT_KEY, type: "upgrade", value: String(limit) }] : [];
}

/**
 * Does casting a new Concentration spell replace one? Like dnd5e (activity/mixin.mjs, `_prepareUsageConfig`): only if the
 * creature already holds as many as its limit. A limit of 0 (tracking disabled) replaces nothing.
 */
export function replacesConcentration(held, limit) {
  const max = Number(limit);
  return (Number.isFinite(max) && (max > 0)) ? ((Number(held) || 0) >= max) : false;
}
