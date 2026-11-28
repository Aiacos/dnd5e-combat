/**
 * Missing enchantments of dnd5e 6.1's "ModifyItem" advancement (`modify-item` check of the diagnostic, §453).
 *
 * This advancement places an enchantment of the feature on another item of the sheet (Enhanced Strikes → the unarmed attack,
 * Poisoned Weapons → Sneak Attack, Subtle Mage Hand → the Mage Hand spell…). dnd5e does it only when the advancement is applied
 * (`ModifyItemAdvancement#apply`), on the targeted items ALREADY present: an item that arrived later (a spell learned
 * afterwards), or a feature replaced by its Player's Handbook 3.0.0 version (check `phb3-items`), stays without an
 * enchantment, and nothing signals it.
 *
 * An enchantment is present on the targeted item when one of its effects:
 *  - bears dnd5e's mark `flags.dnd5e.advancementOrigin` = "<feature id>.<advancement id>" and comes from that effect
 *    (`flags.dnd5e.sourceId`: the uuid of the feature's effect, ending in ".ActiveEffect.<id>", or the remote uuid of the change);
 *  - or is noted in the advancement's `value.modified` (same change, same item, effect still there);
 *  - or is an enchantment of the same name (placed otherwise, by an older version: do not double it).
 *
 * Pure: receives plain descriptions, without a Foundry document.
 */

/** The mark that dnd5e places on the enchantment: "<feature>.<advancement>". */
export const modifyOrigin = (featureId, advancementId) => `${featureId}.${advancementId}`;

/**
 * Does the targeted item's effect come from this change?
 * @param {{ id: string, name?: string, type?: string, advancementOrigin?: string, sourceId?: string }} effect
 * @param {{ origin: string, change: { _id: string, uuid?: string|null }, effectName?: string }} wanted
 */
export function comesFromChange(effect, { origin, change, effectName }) {
  if ( effect.advancementOrigin === origin ) {
    const source = effect.sourceId ?? "";
    if ( !source || source.endsWith(`.ActiveEffect.${change._id}`) || (change.uuid && (source === change.uuid)) ) return true;
  }
  return !!effectName && (effect.type === "enchantment") && (effect.name === effectName);
}

/**
 * The missing enchantments of a sheet.
 * @param {Array<{ id: string, name: string, advancements: Array<{ id: string,
 *   changes: Array<{ _id: string, uuid?: string|null, identifiers: string[], effectName?: string, exists?: boolean }>,
 *   modified?: Array<{ change: string, item: string, effect: string }> }> }>} features  features with a ModifyItem advancement
 * @param {(key: string) => Array<{ id: string, name: string, dependent?: boolean }>} targetsOf  "type:identifier" → sheet items
 * @param {(itemId: string) => Array<{ id: string, name?: string, type?: string, advancementOrigin?: string, sourceId?: string }>}
 *   effectsOf
 * @returns {Array<{ feature: object, advancement: object, change: object, target: { id: string, name: string } }>}
 */
export function missingModifications(features, targetsOf, effectsOf) {
  const out = [];
  for ( const feature of features ) {
    for ( const advancement of feature.advancements ) {
      const origin = modifyOrigin(feature.id, advancement.id);
      for ( const change of advancement.changes ) {
        if ( change.exists === false ) continue;   // the feature's effect does not exist: nothing to place
        const seen = new Set();
        for ( const key of change.identifiers ?? [] ) {
          for ( const target of targetsOf(key) ?? [] ) {
            if ( seen.has(target.id) || target.dependent || (target.id === feature.id) ) continue;
            seen.add(target.id);
            const effects = effectsOf(target.id) ?? [];
            const recorded = (advancement.modified ?? []).some(m => (m.change === change._id) && (m.item === target.id)
              && effects.some(e => e.id === m.effect));
            if ( recorded ) continue;
            if ( effects.some(e => comesFromChange(e, { origin, change, effectName: change.effectName })) ) continue;
            out.push({ feature, advancement, change, target });
          }
        }
      }
    }
  }
  return out;
}
