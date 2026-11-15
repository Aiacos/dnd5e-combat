/**
 * Enchantements manquants de la progression « ModifyItem » de dnd5e 6.1 (vérification `modify-item` du diagnostic, §453).
 *
 * Cette progression pose un enchantement de l'aptitude sur un autre objet de la fiche (Frappes renforcées → l'attaque à mains nues,
 * Armes empoisonnées → Frappe rusée, Main de mage subtile → le sort Main de mage…). dnd5e ne le fait qu'à l'application de la progression
 * (`ModifyItemAdvancement#apply`), sur les objets visés DÉJÀ présents : un objet arrivé après (un sort appris plus tard), ou une aptitude
 * remplacée par sa version du Manuel 3.0.0 (vérification `phb3-items`), reste sans enchantement, et rien ne le signale.
 *
 * Un enchantement est présent sur l'objet visé quand l'un de ses effets :
 *  - porte la marque de dnd5e `flags.dnd5e.advancementOrigin` = « <id de l'aptitude>.<id de la progression> » et vient de cet effet
 *    (`flags.dnd5e.sourceId` : l'uuid de l'effet de l'aptitude, qui finit par « .ActiveEffect.<id> », ou l'uuid distant du changement) ;
 *  - ou est noté dans `value.modified` de la progression (même changement, même objet, effet encore là) ;
 *  - ou est un enchantement du même nom (posé autrement, par une ancienne version : ne pas le doubler).
 *
 * Pur : reçoit des descriptions simples, sans document Foundry.
 */

/** La marque que dnd5e pose sur l'enchantement : « <aptitude>.<progression> ». */
export const modifyOrigin = (featureId, advancementId) => `${featureId}.${advancementId}`;

/**
 * L'effet de l'objet visé vient-il de ce changement ?
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
 * Les enchantements manquants d'une fiche.
 * @param {Array<{ id: string, name: string, advancements: Array<{ id: string,
 *   changes: Array<{ _id: string, uuid?: string|null, identifiers: string[], effectName?: string, exists?: boolean }>,
 *   modified?: Array<{ change: string, item: string, effect: string }> }> }>} features  les aptitudes qui ont une progression ModifyItem
 * @param {(key: string) => Array<{ id: string, name: string, dependent?: boolean }>} targetsOf  « type:identifiant » → objets de la fiche
 * @param {(itemId: string) => Array<{ id: string, name?: string, type?: string, advancementOrigin?: string, sourceId?: string }>} effectsOf
 * @returns {Array<{ feature: object, advancement: object, change: object, target: { id: string, name: string } }>}
 */
export function missingModifications(features, targetsOf, effectsOf) {
  const out = [];
  for ( const feature of features ) {
    for ( const advancement of feature.advancements ) {
      const origin = modifyOrigin(feature.id, advancement.id);
      for ( const change of advancement.changes ) {
        if ( change.exists === false ) continue;   // l'effet de l'aptitude n'existe pas : rien à poser
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
