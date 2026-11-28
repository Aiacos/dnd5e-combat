/**
 * A task's document, as it is at repair time. A task keeps the analysis's document; in the meantime, another
 * repair of the same pass may have:
 *  - had the core recreate a token's own actor (seen: repairing the base actor, then its unlinked token, failed);
 *  - removed it. dnd5e deletes with an item the spells it gave ("cast" activity, `flags.dnd5e.cachedFor`) and recreates them
 *    under another id with the new item: Midi-QOL's cleanup that replaces the item thus leaves, for these spells, tasks
 *    without a document (#110). Returning the analysis's document then sent the write to a parent the database no longer has.
 */

/** A task's document no longer exists: nothing to repair, and nothing abnormal (index.mjs returns it as a past task). */
export class VanishedError extends Error {
  constructor(uuid) {
    super(`document ${uuid} no longer exists`);
    this.name = "VanishedError";
    this.vanished = true;
  }
}

/** Le document relu, ou `null` s'il n'existe plus. */
function reread(doc) {
  // A token's own actor is re-read through its token (its uuid alone does not return the own actor, seen in play);
  // its items, through it.
  if ( (doc?.documentName === "Actor") && doc.isToken ) return fromUuidSync(doc.token.uuid, { strict: false })?.actor ?? null;
  if ( (doc?.parent?.documentName === "Actor") && doc.parent.isToken ) {
    return reread(doc.parent)?.[doc.collectionName]?.get(doc.id) ?? null;
  }
  return fromUuidSync(doc.uuid, { strict: false }) ?? null;
}

/** The document as it is now. Throws `VanishedError` if it no longer exists. */
export function fresh(doc) {
  const now = reread(doc);
  if ( !now ) throw new VanishedError(doc?.uuid);
  return now;
}
