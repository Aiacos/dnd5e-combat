/**
 * Issue #112: effects that failed to initialize. The core keeps such a document's id in `effects.invalidDocumentIds` (an
 * effect whose type came from a module that is no longer active, for instance) and logs an error each time the sheet is
 * prepared. Pure readers, so that the diagnostic can list a sheet for that reason alone.
 */

/**
 * The ids of the effects of this document that failed to initialize.
 * @param {{effects?: {invalidDocumentIds?: Iterable<string>}}|null} doc  An Actor or an Item.
 * @returns {string[]}
 */
export function invalidEffectIds(doc) {
  return [...(doc?.effects?.invalidDocumentIds ?? [])];
}

/**
 * Does this sheet carry an effect that failed to initialize, on the actor itself or on one of its items?
 * @param {{effects?: object, items?: Iterable<object>}|null} actor
 * @returns {boolean}
 */
export function hasInvalidEffects(actor) {
  if ( invalidEffectIds(actor).length ) return true;
  for ( const item of actor?.items ?? [] ) if ( invalidEffectIds(item).length ) return true;
  return false;
}
