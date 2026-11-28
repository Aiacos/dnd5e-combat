/**
 * Whom an activity can target with a click (aiming mode, ui/pointer.mjs), from the target type dnd5e gives it
 * (`target.affects.type`, CONFIG.DND5E.individualTargetTypes, config.mjs:2814): self, ally, enemy, creature, object,
 * space, creatureOrObject, any, willing. 2024 rules: "a creature" includes you, unless the text says "another
 * creature" (and dnd5e does not encode that: it is then up to the player not to click themselves); an attack never targets
 * its author.
 * Pure functions.
 */

/** The types that are targeted by clicking a creature. */
export const CLICK_TARGET_TYPES = Object.freeze(["creature", "creatureOrObject", "ally", "enemy", "object", "willing", "any"]);

/** Those that can designate the caster itself. */
const SELF_ALLOWED = Object.freeze(["creature", "creatureOrObject", "ally", "willing", "any"]);

/**
 * The aiming rule of an activity, or null if it is not targeted with a click (area to place, personal range, space).
 * @param {{type: string, affects?: string, rangeUnits?: string, template?: string}} activity
 * @returns {{self: boolean, side: "ally"|"enemy"|null}|null}
 */
export function targetRule({ type, affects, rangeUnits, template }) {
  if ( template ) return null;                                      // an area is placed, it is not targeted
  if ( type === "attack" ) return { self: false, side: null };
  if ( !CLICK_TARGET_TYPES.includes(affects) || (rangeUnits === "self") ) return null;
  return { self: SELF_ALLOWED.includes(affects), side: ["ally", "enemy"].includes(affects) ? affects : null };
}

/**
 * Relation between two token dispositions (1 friendly, 0 neutral, -1 hostile, -2 secret): "same" (same declared side),
 * "opposed" (friendly against hostile), "neutral" (everything else: unknown).
 */
export function relationOf(mine, theirs) {
  if ( ![1, -1].includes(mine) || ![1, -1].includes(theirs) ) return "neutral";
  return mine === theirs ? "same" : "opposed";
}

/**
 * Why this click cannot designate this creature, or null. "self": not oneself; "notAlly": a declared enemy
 * for a spell that targets an ally; "notEnemy": a declared ally (or oneself) for a spell that targets an enemy. A neutral
 * or secret token is never refused: we do not know which side it is on.
 * @param {{self: boolean, side: string|null}} rule
 * @param {{isSelf: boolean, relation: "same"|"opposed"|"neutral"}} candidate
 */
export function targetRefusal(rule, { isSelf, relation }) {
  if ( !rule ) return null;
  if ( isSelf ) return rule.self ? null : "self";
  if ( (rule.side === "ally") && (relation === "opposed") ) return "notAlly";
  if ( (rule.side === "enemy") && (relation === "same") ) return "notEnemy";
  return null;
}
