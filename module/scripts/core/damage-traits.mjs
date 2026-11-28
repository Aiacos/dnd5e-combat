/**
 * A trait that responds to a type of damage taken (content key `onDamageTaken`): "if it takes cold damage, its Speed is reduced by
 * 6 m until the end of its next turn" (Water Elemental, Freeze), "if it takes fire damage, it has Disadvantage on attack rolls
 * and ability checks until the end of its next turn" (Flesh Golem, Aversion to Fire). This is not a
 * Reaction: nothing is asked, nothing is spent — the trait's effect is placed on its bearer. Pure functions.
 */

/**
 * Does the rule apply to this damage?
 * @param {{types: string[], effect: string}|null|undefined} rule  `onDamageTaken` of the entry.
 * @param {string[]} taken  The types of damage actually taken (value > 0, after Resistances and Immunities).
 */
export function damageTraitHits(rule, taken) {
  if ( !rule?.effect || !Array.isArray(rule.types) || !rule.types.length ) return false;
  return (taken ?? []).some(t => rule.types.includes(t));
}

/** The key's errors. Empty = valid. */
export function validateOnDamageTaken(rule, at, damageTypes, isId) {
  const errors = [];
  const shape = `${at}onDamageTaken: { types: [damage types], effect: effect id }`;
  if ( !rule || (typeof rule !== "object") || Array.isArray(rule) ) return [shape];
  if ( !Array.isArray(rule.types) || !rule.types.length || !rule.types.every(t => damageTypes.includes(t)) ) errors.push(shape);
  else if ( !isId(rule.effect) ) errors.push(shape);
  for ( const key of Object.keys(rule) ) if ( !["types", "effect"].includes(key) ) errors.push(`${at}onDamageTaken.${key}: unknown key`);
  return errors;
}

/**
 * The data of the trait's effect to place on its bearer: the copy of the item effect, without its id, which keeps its source
 * (`_stats.duplicateSource`) as dnd5e's effect tray does — through it the engine recognizes the item effect
 * (`comesFromItemEffect`) and applies what the entry says about it (`effectEnds`).
 * @param {object} data        `effect.toObject()` of the item effect
 * @param {string} sourceUuid  uuid of the item effect
 * @param {string} itemUuid    uuid of the item, origin of the placed effect
 */
export function traitEffectData(data, sourceUuid, itemUuid) {
  const { _id, ...rest } = data ?? {};
  return { ...rest, origin: itemUuid, transfer: false, disabled: false,
    _stats: { ...(rest._stats ?? {}), duplicateSource: sourceUuid } };
}

