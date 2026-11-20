/**
 * §494 (brique B14) : plusieurs concentrations à la fois. dnd5e 6 en porte la limite (`system.attributes.concentration.limit`,
 * 1 par défaut) : à la limite, un nouveau sort à concentration remplace celle du même item, sinon la première ; un jet de concentration
 * raté met fin à toutes (`endConcentration()` sans argument, bouton « Rompre la concentration »). Il manque la limite portée par un trait
 * de créature (« elle peut se concentrer sur trois sorts à la fois ») : la clé de contenu `concentration: { limit, loseAll? }`, que le
 * moteur tient dans l'effet des dons sans effet (runtime/speed-grants.mjs). Fonctions pures.
 */

export const CONCENTRATION_LIMIT_KEY = "system.attributes.concentration.limit";

/** Validation de la clé `concentration` ; rend la liste des erreurs. */
export function validateConcentrationRule(rule) {
  const ok = (rule !== null) && (typeof rule === "object") && !Array.isArray(rule)
    && Number.isInteger(rule.limit) && (rule.limit >= 1) && (rule.limit <= 20)
    && (!("loseAll" in rule) || (rule.loseAll === true))
    && Object.keys(rule).every(k => ["limit", "loseAll"].includes(k));
  return ok ? [] : ["concentration: { limit: integer 1–20, loseAll?: true }"];
}

/**
 * La règle de concentration de la créature, d'après les entrées de ses items : la plus haute limite, et « perd tout » si l'une le dit.
 * @param {Array<object|null>} entries  Les entrées de contenu de ses items.
 * @returns {{limit: number, loseAll: boolean}|null}  null : aucun item ne déclare de règle.
 */
export function concentrationRuleOf(entries) {
  const rules = (entries ?? []).map(e => e?.concentration).filter(r => Number.isInteger(r?.limit));
  if ( !rules.length ) return null;
  return { limit: Math.max(...rules.map(r => r.limit)), loseAll: rules.some(r => r.loseAll === true) };
}

/** Les changements d'effet qui portent la limite (« upgrade » : un effet de la fiche qui la monte plus haut garde le dessus). */
export function concentrationLimitChanges(rule) {
  const limit = Number(rule?.limit);
  return (Number.isInteger(limit) && (limit > 1)) ? [{ key: CONCENTRATION_LIMIT_KEY, type: "upgrade", value: String(limit) }] : [];
}

/**
 * Lancer un nouveau sort à concentration en remplace-t-il un ? Comme dnd5e (activity/mixin.mjs, `_prepareUsageConfig`) : seulement si la
 * créature en tient déjà autant que sa limite. Une limite de 0 (suivi désactivé) ne remplace rien.
 */
export function replacesConcentration(held, limit) {
  const max = Number(limit);
  return (Number.isFinite(max) && (max > 0)) ? ((Number(held) || 0) >= max) : false;
}
