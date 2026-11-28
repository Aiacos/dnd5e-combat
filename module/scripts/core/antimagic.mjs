/**
 * §436: antimagic, pure rules. dnd5e 6.1 carries the `antimagic` status (applied by the `dnd5e.antimagic` region behavior) and
 * itself suspends the `system.magical` effects and the bonuses of magic items of an actor that bears it; the engine adds what the
 * system does not do (refuse to cast, protect the targets, bound teleportation) and marks magical effects as dnd5e's
 * migration would.
 */

/** L'identifiant du statut de dnd5e 6.1 (`CONFIG.DND5E.statusEffects.antimagic`). */
export const ANTIMAGIC_STATUS = "antimagic";

/** The type of the dnd5e 6.1 region behavior that applies the status. */
export const ANTIMAGIC_BEHAVIOR = "dnd5e.antimagic";

/**
 * An item whose effects are magical — the rule of dnd5e's migration (`_migrateEffectMagical`): a spell, a scroll, or an
 * item with the `mgc` property; §436: or a feature that the content says is magical (`magical`).
 * @param {{type?: string, subtype?: string, properties?: Iterable<string>, magical?: boolean}} item
 */
export function isMagicalSource(item) {
  if ( !item ) return false;
  if ( item.magical === true ) return true;
  if ( item.type === "spell" ) return true;
  if ( (item.type === "consumable") && (item.subtype === "scroll") ) return true;
  return new Set(item.properties ?? []).has("mgc");
}

/**
 * A use that the field forbids to whoever stands in it, and from which it protects whoever stands in it: a spell cast (scroll
 * included), or an activity of a magic item — except the attack of a magic weapon, which strikes like an ordinary weapon (dnd5e
 * already removes its bonus, `magicAvailable`).
 * @param {{spellCast?: boolean, item?: object, activityType?: string, magical?: boolean}} use
 */
export function isMagicalUse({ spellCast=false, item=null, activityType=null, magical=false }={}) {
  // §436: a `cast` activity (spell cast by a feature or an item); a feature that the content says is magical (`magical`).
  if ( spellCast || magical || (activityType === "cast") ) return true;
  if ( !isMagicalSource(item) ) return false;
  return !((item.type === "weapon") && (activityType === "attack"));
}

/**
 * Must `system.magical` be marked on this effect? An ordinary effect (type `base`, not a condition or a Concentration), not yet
 * marked, whose origin item is magical.
 * @param {{type?: string, magical?: boolean, statuses?: Iterable<string>}} effect
 * @param {object|null} originItem   as for isMagicalSource
 */
export function shouldMarkMagical(effect, originItem) {
  if ( !effect || effect.magical ) return false;
  if ( (effect.type ?? "base") !== "base" ) return false;
  const statuses = new Set(effect.statuses ?? []);
  if ( statuses.has("concentrating") || statuses.has(ANTIMAGIC_STATUS) ) return false;
  return isMagicalSource(originItem);
}

/**
 * An activity that dnd5e hides **only** because of the antimagic status, and that the engine can therefore offer to force:
 * dnd5e refuses it (`canUse` false) because it requires magic (`visibility.requireMagic`, set on every spell and every
 * "cast" activity) and the item no longer has any (`magicAvailable` false under the status), the item itself stays usable,
 * and it is a magical use. Any other
 * reason to hide it (attunement, identification, level) is not lifted by forcing: no offer.
 * @param {{inAntimagic?: boolean, canUse?: boolean, itemCanUse?: boolean, requireMagic?: boolean, magicAvailable?: boolean,
 *   otherHidden?: boolean, magicalUse?: boolean}} facts
 */
export function blockedByAntimagic({ inAntimagic=false, canUse=true, itemCanUse=true, requireMagic=false, magicAvailable=true,
  otherHidden=false, magicalUse=false }={}) {
  return inAntimagic && !canUse && (itemCanUse !== false) && requireMagic && (magicAvailable === false) && !otherHidden && magicalUse;
}
