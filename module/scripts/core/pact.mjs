/**
 * Pact weapon (SPEC §16.45, key `pact` of core/content.mjs): the "Pact Weapon" enchantment of PHB 2.2.0 makes the weapon
 * proficient and a focus, and **adds** the Necrotic, Psychic and Radiant types to its damage (one would choose on each roll);
 * it does not apply Charisma. PHB 2024: the Warlock can attack and strike with Charisma rather than Strength or
 * Dexterity, and choose between Necrotic, Psychic, Radiant damage or the weapon's own type. The type is chosen
 * **on each attack** (user request, 2026-09-26: adapter/messages.mjs, `damageTypeChoices`): the added types remain,
 * unless a type is imposed. Pure functions.
 */

const TYPE_KEYS = Object.freeze(["system.damage.base.types", "system.damage.versatile.types"]);

/**
 * The enchantment's changes, rewritten according to the choice.
 * @param {Array<{key: string, type: string, value: *}>} changes  Those of dnd5e's profile.
 * @param {{damageTypes: string[], chosen: string|null, ability?: string|null, suffix?: string|null}} options
 *        `chosen`: one of the `damageTypes` imposed, or null (all remain: the choice is made on each attack); `ability`: the
 *        ability of the weapon's attacks ("spellcasting"); `suffix`: what is appended to the weapon's name.
 */
export function rewritePactChanges(changes, { damageTypes, chosen=null, ability=null, suffix=null }) {
  const imposed = chosen && damageTypes.includes(chosen);
  const out = (changes ?? []).filter(c => !(imposed && TYPE_KEYS.includes(c.key) && damageTypes.includes(String(c.value))))
    .map(c => ((c.key === "name") && suffix) ? { ...c, value: suffix } : c);
  if ( imposed ) for ( const key of TYPE_KEYS ) out.push({ key, type: "override", value: chosen, phase: "initial" });
  if ( ability ) out.push({ key: "activities[attack].attack.ability", type: "override", value: ability, phase: "initial" });
  return out;
}
