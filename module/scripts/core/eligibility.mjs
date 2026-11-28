/**
 * Whom an action can affect (SPEC §16.8): creature type and immunities. Pure functions, no dependency on Foundry.
 *
 * What dnd5e 6.0.3 already does, and is NOT taken over here:
 *  - Immunities, Resistances, Vulnerabilities to DAMAGE: `Actor5e#applyDamage` → `calculateDamage`, through which the
 *    engine applies all its damage;
 *  - immunity to a CONDITION: the condition is removed from the creature's conditions (`prepareResistImmune`, data/actor/templates/
 *    traits.mjs) and the condition effect is suspended (data/active-effect/condition.mjs, `isSuppressed`).
 *
 * What the system does not do, and the engine adds:
 *  - "Choose a Humanoid": no activity data restricts the target's type (\`target.affects.type\`
 *    is "creature") — the content declares it (\`targets.types\`);
 *  - an effect that groups several conditions (Hypnotic Pattern: Charmed AND Incapacitated) stays applied with its other conditions
 *    on a creature immune to one of them; yet these conditions all derive from the first. Engine rule: a
 *    creature immune to ONE of an effect's conditions does not receive that effect;
 *  - an action that would do nothing but apply effects the creature cannot receive does not affect it
 *    at all: no save asked for nothing.
 */

/** The creature types of dnd5e 6 (`CONFIG.DND5E.creatureTypes`), to validate content outside Foundry. */
export const CREATURE_TYPES = Object.freeze([
  "aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid",
  "monstrosity", "ooze", "plant", "undead"
]);

/**
 * Is the creature's type allowed? No restriction, or unknown type (sheet without a type): yes — we never refuse
 * out of ignorance.
 * @param {string[]|null|undefined} types  Allowed types (content `targets.types`).
 * @param {string|null} creatureType
 */
export function typeAllowed(types, creatureType) {
  if ( !types?.length || !creatureType ) return true;
  return types.includes(creatureType);
}

/**
 * The target rule of a spell copy cast by the "cast" activity of an item: the spell's own, completed by what the casting item
 * says for that activity (`spellTargets`: Ring of Animal Influence — "Fear (affects only Beasts)").
 * What the item declares wins, key by key.
 * @param {object|null} own  `targets` of the spell's entry.
 * @param {Record<string, object>|null|undefined} spellTargets  `spellTargets` of the casting item.
 * @param {string|null} activityId  The originating "cast" activity.
 * @returns {object|null}
 */
export function castTargetRule(own, spellTargets, activityId) {
  const added = activityId ? (spellTargets?.[activityId] ?? null) : null;
  if ( !added ) return own ?? null;
  return { ...(own ?? {}), ...added };
}

/**
 * Is the subtype of a creature (`details.type.subtype` of dnd5e, free text: "Demon", "Devil", "Goblinoid") the expected
 * one, or one of the expected ones? Ignoring case and surrounding spaces; without a subtype: no.
 * @param {string|null|undefined} subtype
 * @param {string|string[]} want
 */
export function subtypeMatches(subtype, want) {
  const own = String(subtype ?? "").trim().toLowerCase();
  if ( !own ) return false;
  return [want].flat().some(w => String(w ?? "").trim().toLowerCase() === own);
}

/**
 * `saveDisadvantageAgainst: { subtypes }`: the item's bearer makes with Disadvantage the saves imposed by a creature
 * of one of these subtypes (Demon Armor: "against their spells and special abilities").
 */
export function saveDisadvantageAgainstHolds(rule, sourceSubtype) {
  return Array.isArray(rule?.subtypes) && subtypeMatches(sourceSubtype, rule.subtypes);
}

/** The key's errors. Empty = valid. */
export function validateSaveDisadvantageAgainst(rule, at) {
  const ok = rule && (typeof rule === "object") && !Array.isArray(rule) && Array.isArray(rule.subtypes) && rule.subtypes.length
    && rule.subtypes.every(t => (typeof t === "string") && t.trim()) && Object.keys(rule).every(k => k === "subtypes");
  return ok ? [] : [`${at}saveDisadvantageAgainst: { subtypes: [creature subtype, …] }`];
}

/** The conditions of an effect that the creature is immune to (empty: the effect can be applied). */
export function blockedStatuses(statuses, immunities) {
  const immune = new Set(immunities ?? []);
  return Array.from(statuses ?? []).filter(s => immune.has(s));
}

/**
 * Does the action not affect the creature at all? Yes if it only applies effects (no damage, no healing,
 * no outcome step) and each of them carries a condition the creature is immune to.
 * @param {object} plan
 * @param {boolean} plan.damage          The action deals damage or heals.
 * @param {boolean} plan.steps           It has outcome steps (push, condition applied by the engine).
 * @param {string[][]} plan.effects      The conditions of each of its effects.
 * @param {string[]} immunities
 * @returns {string|null}  The first blocking condition, or null.
 */
export function immuneToAll({ damage=false, steps=false, effects=[] }, immunities) {
  if ( damage || steps || !effects.length ) return null;
  let first = null;
  for ( const statuses of effects ) {
    const blocked = blockedStatuses(statuses, immunities);
    if ( !blocked.length ) return null;
    first ??= blocked[0];
  }
  return first;
}
