/**
 * Batch 1 of the 2026-10-30 workstreams: failure of a spell cast under an effect that hinders it (Slow, PHB 2024 — "if it casts a
 * spell with a Somatic component, there is a 25 percent chance that the spell fails"). Pure: the rules are read from the content of
 * the source items of the caster's effects (`spellFailure`), the roll is made elsewhere.
 */

/** The components a rule can name (dnd5e spell properties). */
export const SPELL_COMPONENTS = Object.freeze(["vocal", "somatic", "material"]);

/**
 * The failure rule that applies to a spell, or null. `rules`: the `spellFailure` of the caster's effects, with the name of the
 * item that carries them (`{ chance, component?, name }`); `properties`: the properties of the cast spell. The highest chance
 * wins (two Slows do not stack).
 */
export function failureFor(rules, properties) {
  const has = new Set(properties ?? []);
  let best = null;
  for ( const rule of rules ?? [] ) {
    const chance = Number(rule?.chance);
    if ( !(chance > 0) ) continue;
    if ( rule.component && !has.has(rule.component) ) continue;
    if ( !best || (chance > best.chance) ) best = { ...rule, chance };
  }
  return best;
}

/** Does the spell fail on this d100 roll? ("25 percent chance": 1 to 25.) */
export function spellFailed(chance, d100) {
  return Number.isFinite(d100) && (d100 <= chance);
}
