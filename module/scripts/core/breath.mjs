/**
 * A creature's breath, and the Advantage an item gives against it (content key `breathAdvantage`: Dragon Scale Mail
 * — "Advantage on saving throws against the breath of Dragons"). A breath is recognized by the identifier of its
 * feature: "fire-breath", "sleep-breath"… ("hold-breath", holding one's breath, is not one). Pure functions.
 */

/** Is this feature identifier that of a breath? */
export function isBreathWeapon(identifier) {
  return (typeof identifier === "string") && /-breath$/.test(identifier) && (identifier !== "hold-breath");
}

/** Does the rule apply against a creature of this type? */
export function breathAdvantageHolds(rule, creatureType) {
  return !!creatureType && Array.isArray(rule?.types) && rule.types.includes(creatureType);
}
