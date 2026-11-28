/**
 * §214: Armor Training (2024 rules, glossary "Armor Training"). Without training for the worn armor: Disadvantage on
 * d20 Tests that use Strength or Dexterity, and no spells; without training for the shield: no AC bonus.
 *
 * dnd5e 6 computes the training (`EquipmentData#proficiencyMultiplier`, data/item/equipment.mjs:180 — an NPC is always trained in
 * the armors of its stat block) but draws nothing from it: no Disadvantage, no spells, and the shield still counts toward AC
 * (data/actor/templates/attributes.mjs:290-296).
 */

/** The abilities whose d20 tests have Disadvantage. */
export const UNTRAINED_ABILITIES = Object.freeze(["str", "dex"]);

const untrained = item => !!item && (Number(item.system?.proficiencyMultiplier ?? 1) === 0);

/** The armor worn without training, or null (a character only). */
export function untrainedArmor(actor) {
  if ( actor?.type !== "character" ) return null;
  const armor = actor.system.attributes?.ac?.equippedArmor ?? null;
  return untrained(armor) ? armor : null;
}

/** The shield carried without training, or null (a character only). */
export function untrainedShield(actor) {
  if ( actor?.type !== "character" ) return null;
  const shield = actor.system.attributes?.ac?.equippedShield ?? null;
  return untrained(shield) ? shield : null;
}

/** Does this d20 test (ability) have the Disadvantage of untrained armor? Returns the armor, or null. */
export function armorHampers(actor, ability) {
  return UNTRAINED_ABILITIES.includes(ability) ? untrainedArmor(actor) : null;
}
