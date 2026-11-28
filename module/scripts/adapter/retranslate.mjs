/**
 * §203–§204: take over the current translation of the compendiums (Babele, this client's language) for a world item or actor
 * that comes from one and whose texts stayed in the original language. Served to the diagnostic ("Texts left in the original
 * language", runtime/diagnostic/checks.mjs) and to creation (runtime/auto-translate.mjs). The rules are in core/localize.mjs:
 * a field is taken over only if it still equals the original exactly; identifiers and activity and effect ids do not change.
 */
import { retranslateItem, retranslateActor } from "../core/localize.mjs";

/** La source de compendium d'un document (`_stats.compendiumSource`, sinon l'ancien `flags.core.sourceId`). */
export const sourceOf = doc => doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? null;

/** A reader of translated references, with its cache: returns the compendium document if it carries Babele's original payload. */
export function referenceReader() {
  const cache = new Map();
  return async uuid => {
    if ( !uuid?.startsWith?.("Compendium.") ) return null;
    if ( !cache.has(uuid) ) cache.set(uuid, await fromUuid(uuid).catch(() => null));
    const doc = cache.get(uuid);
    return doc?.flags?.babele?.originalPayload ? doc : null;
  };
}

/** An item's base actor (that of an unlinked token: its world actor). */
function baseActor(item) {
  const actor = item.parent;
  if ( actor?.documentName !== "Actor" ) return null;
  return actor.isToken ? (game.actors.get(actor.token?.actorId) ?? null) : actor;
}

/**
 * What needs rewriting in this document. Empty `fields`: nothing. An item's reference is the one with the same id in the
 * translated creature its sheet comes from, otherwise its own source.
 * @param {Item|Actor} doc
 * @param {Function} [reference]  A reader (`referenceReader()`), shared to benefit from the cache.
 * @returns {Promise<{ update: object, effects: object[], fields: string[] }>}
 */
export async function retranslationOf(doc, reference=referenceReader()) {
  const none = { update: {}, effects: [], fields: [] };
  if ( !game.babele || !doc ) return none;
  if ( doc.documentName === "Actor" ) {
    const ref = await reference(sourceOf(doc));
    if ( !ref ) return none;
    return { effects: [], ...retranslateActor(doc.toObject(), ref.flags.babele.originalPayload, ref.toObject()) };
  }
  const refActor = await reference(sourceOf(baseActor(doc)));
  let ref = refActor?.items?.get(doc.id) ?? null;
  if ( !ref?.flags?.babele?.originalPayload ) ref = await reference(sourceOf(doc));
  if ( !ref ) return none;
  return retranslateItem(doc.toObject(), ref.flags.babele.originalPayload, ref.toObject());
}

/**
 * Applies what `retranslationOf` found. A document without a registered identifier gets its own from its name (dnd5e,
 * documents/mixins/document.mjs:33): translating it would change the identifier by which the engine and dnd5e recognize it. The
 * previous one is frozen before renaming.
 */
export async function applyRetranslation(doc, { update, effects }) {
  const data = { ...update };
  if ( ("name" in data) && !doc._source?.system?.identifier && doc.identifier ) data["system.identifier"] = doc.identifier;
  if ( Object.keys(data).length ) await doc.update(data);
  if ( effects?.length ) await doc.updateEmbeddedDocuments("ActiveEffect", effects);
}
